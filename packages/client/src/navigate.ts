/**
 * Navigation: URL normalize/resolve, template expand, cycle detect, same-origin
 * (SPEC v0.4-Ultimate §8, §10.1).
 */

import { AppError } from './errors.js';
import type { ActionDef } from './types.js';

const MAX_STACK = 64;
const CYCLE_WINDOW = 8;
const CYCLE_THRESHOLD = 3;
const MAX_REDIRECTS = 5;
const MAX_URL_LENGTH = 2048;

/** Unreserved chars per RFC 3986 — decode these in percent-encoding normalize. */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  // 127.0.0.0/8
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  return [m[1], m[2], m[3]].every((o) => {
    const n = Number(o);
    return n >= 0 && n <= 255;
  });
}

/**
 * Percent-encoding normalize: uppercase hex; decode unreserved chars (§8.1).
 */
export function normalizePercentEncoding(input: string): string {
  return input.replace(/(%[0-9A-Fa-f]{2})+/g, (seq) => {
    const bytes: number[] = [];
    for (let i = 0; i < seq.length; i += 3) {
      bytes.push(parseInt(seq.slice(i + 1, i + 3), 16));
    }
    let out = '';
    for (const b of bytes) {
      const ch = String.fromCharCode(b);
      if (UNRESERVED.test(ch)) {
        out += ch;
      } else {
        out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
    return out;
  });
}

/**
 * Remove dot-segments from a path (RFC 3986 §5.2.4).
 */
export function removeDotSegments(path: string): string {
  const input = path.split('/');
  const output: string[] = [];
  for (const seg of input) {
    if (seg === '.' || seg === '') {
      if (seg === '' && (output.length === 0 || input.indexOf(seg) === input.length - 1)) {
        // preserve leading/trailing slash semantics via join — handled below
      }
      if (seg === '') continue;
      continue;
    }
    if (seg === '..') {
      if (output.length > 0) output.pop();
      continue;
    }
    output.push(seg);
  }
  const joined = '/' + output.join('/');
  // Preserve trailing slash if original had one (and wasn't just "/")
  if (path.endsWith('/') && joined !== '/') return `${joined}/`;
  return joined === '' ? '/' : joined;
}

/**
 * Normalization for equality (§8.1):
 * lowercase scheme+host; strip default ports; remove dot-segments;
 * percent-encoding normalize; fragment strip; query order significant.
 */
export function normalizeAppUrl(url: string, base?: string): string {
  let u: URL;
  try {
    u = base ? new URL(url, base) : new URL(url);
  } catch {
    throw new AppError('app.err.navigation.invalid_url', {
      message: `Cannot parse URL: ${url}`,
    });
  }

  u.hash = '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // Strip default ports
  if (
    (u.protocol === 'https:' && u.port === '443') ||
    (u.protocol === 'http:' && u.port === '80')
  ) {
    u.port = '';
  }

  // Dot-segment removal on pathname
  u.pathname = removeDotSegments(u.pathname);

  // Percent-encoding normalize on path + query (query order preserved)
  u.pathname = normalizePercentEncoding(u.pathname);
  if (u.search) {
    // Empty query `?` treated equal to absent
    if (u.search === '?') {
      u.search = '';
    } else {
      u.search = normalizePercentEncoding(u.search);
    }
  }

  let href = u.href;
  // Empty query `?` — URL.href may retain trailing ?
  if (href.endsWith('?')) {
    href = href.slice(0, -1);
  }
  if (href.length > MAX_URL_LENGTH) {
    throw new AppError('app.err.navigation.invalid_url', {
      message: `URL exceeds ${MAX_URL_LENGTH} characters`,
    });
  }
  return href;
}

export function extractOrigin(url: string): string {
  const u = new URL(normalizeAppUrl(url));
  return u.origin;
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    return extractOrigin(a) === extractOrigin(b);
  } catch {
    return false;
  }
}

export function assertSameOrigin(targetUrl: string, pageUrl: string): void {
  if (!isSameOrigin(targetUrl, pageUrl)) {
    throw new AppError('app.err.security.cross_origin', {
      message: `Cross-origin blocked: ${targetUrl} vs ${pageUrl}`,
    });
  }
}

/**
 * Resolve URL against base, strip fragment, reject userinfo, enforce https/loopback (§8.1).
 */
export function resolveAppUrl(href: string, baseUrl: string): string {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    throw new AppError('app.err.navigation.invalid_url', {
      message: `Cannot resolve URL: ${href}`,
    });
  }

  if (resolved.username || resolved.password) {
    throw new AppError('app.err.navigation.invalid_url', {
      message: 'Userinfo in URL is not allowed',
    });
  }

  const host = resolved.hostname;
  const isLocal = isLoopbackHost(host);
  if (resolved.protocol === 'http:') {
    if (!isLocal) {
      throw new AppError('app.err.navigation.invalid_url', {
        message: 'http is only allowed for loopback',
      });
    }
  } else if (resolved.protocol !== 'https:') {
    throw new AppError('app.err.navigation.invalid_url', {
      message: `Unsupported scheme: ${resolved.protocol}`,
    });
  }

  return normalizeAppUrl(resolved.href);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function encodeQueryValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 1e21) return String(value);
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => encodeQueryValue(v)).join(',');
  }
  return encodeURIComponent(String(value));
}

/**
 * Expand RFC 6570 Level-1 `{var}` templates (§8.2).
 */
export function expandUrlTemplate(
  template: string,
  params: Record<string, unknown>,
  baseUrl: string,
): string {
  const missing: string[] = [];

  // Reject Level-1+ operators
  if (/\{[+#./;?&*]/.test(template)) {
    throw new AppError('app.err.navigation.template_param', {
      message: 'URI Template operators beyond Level-1 are not supported',
    });
  }

  const withEncoded = template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, name: string) => {
    if (!(name in params) || params[name] === undefined || params[name] === null) {
      missing.push(name);
      return '';
    }
    const raw = params[name];
    const idx = template.indexOf(match);
    const qIdx = template.indexOf('?');
    const inQuery = qIdx !== -1 && idx > qIdx;
    if (inQuery) return encodeQueryValue(raw);
    return encodePathSegment(String(raw));
  });

  if (missing.length > 0) {
    throw new AppError('app.err.navigation.template_param', {
      message: `Missing template param(s): ${missing.join(', ')}`,
      path: missing[0],
    });
  }

  let url: URL;
  try {
    url = new URL(withEncoded, baseUrl);
  } catch {
    throw new AppError('app.err.navigation.invalid_url', {
      message: `Cannot expand template: ${template}`,
    });
  }

  return resolveAppUrl(url.href, baseUrl);
}

/**
 * Safe client-side GET navigation without POST (§8.4).
 */
export function canNavigateWithoutPost(
  actionDef: ActionDef,
  params: Record<string, unknown>,
): boolean {
  if (actionDef.kind !== 'navigate') return false;
  if ((actionDef.side_effect ?? 'safe') !== 'safe') return false;
  if (actionDef.requires_confirmation) return false;
  const auth = actionDef.auth ?? 'none';
  if (auth !== 'none') return false;
  const template = actionDef.output?.navigates_to;
  if (!template || typeof template !== 'string') return false;
  const placeholders = [...template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
  return placeholders.every((p) => params[p] !== undefined && params[p] !== null);
}

export function expandNavigate(
  actionDef: ActionDef,
  params: Record<string, unknown>,
  baseUrl: string,
): string {
  const template = actionDef.output?.navigates_to;
  if (!template || typeof template !== 'string') {
    throw new AppError('app.err.navigation.template_param', {
      message: 'Action has no navigates_to template',
    });
  }
  const expanded = expandUrlTemplate(template, params, baseUrl);
  assertSameOrigin(expanded, baseUrl);
  return expanded;
}

/**
 * Validate 303/201 navigate headers: Location === X-APP-Navigate (TV-39).
 * Returns the agreed absolute URL or throws fail-closed.
 */
export function requireNavigateLocation(
  location: string | null,
  navigate: string | null,
  baseUrl: string,
): string {
  if (!location || !navigate) {
    throw new AppError('app.err.manifest.invalid', {
      message: 'Navigate response requires both Location and X-APP-Navigate',
    });
  }
  let locNorm: string;
  let navNorm: string;
  try {
    locNorm = resolveAppUrl(location, baseUrl);
    navNorm = resolveAppUrl(navigate, baseUrl);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('app.err.navigation.invalid_url', {
      message: 'Invalid Location / X-APP-Navigate URL',
    });
  }
  if (locNorm !== navNorm) {
    throw new AppError('app.err.manifest.invalid', {
      message: 'Location and X-APP-Navigate mismatch (fail closed)',
    });
  }
  assertSameOrigin(locNorm, baseUrl);
  return locNorm;
}

export class NavigationStack {
  private stack: string[] = [];
  private redirectCount = 0;

  constructor(private readonly maxDepth = MAX_STACK) {}

  /**
   * Record navigation; throws on cycle (§8.6 / TV-41).
   * Single-step self-loops (refresh) are ignored for cycle counting.
   */
  push(url: string): void {
    const normalized = normalizeAppUrl(resolveAppUrl(url, url));
    const last = this.stack[this.stack.length - 1];
    if (last === normalized) {
      // Self-loop refresh — legal; still record but do not cycle-check
      this.stack.push(normalized);
      if (this.stack.length > this.maxDepth) this.stack.shift();
      return;
    }
    const window = this.stack.slice(-CYCLE_WINDOW);
    const appearances = window.filter((u) => u === normalized).length;
    if (appearances + 1 >= CYCLE_THRESHOLD) {
      throw new AppError('app.err.navigation.cycle', {
        message: `Navigation cycle detected: URL would appear ${appearances + 1} times in last ${CYCLE_WINDOW}`,
      });
    }
    this.stack.push(normalized);
    if (this.stack.length > this.maxDepth) {
      this.stack.shift();
    }
  }

  beginRedirectChain(): void {
    this.redirectCount = 0;
  }

  /** Track a redirect hop; throws after max 5 (§8.6 / TV-42). */
  trackRedirect(url: string): void {
    this.redirectCount += 1;
    if (this.redirectCount > MAX_REDIRECTS) {
      throw new AppError('app.err.navigation.redirect_loop', {
        message: `Exceeded ${MAX_REDIRECTS} redirects`,
      });
    }
    this.push(url);
  }

  resetRedirects(): void {
    this.redirectCount = 0;
  }

  entries(): string[] {
    return [...this.stack];
  }

  clear(): void {
    this.stack = [];
    this.redirectCount = 0;
  }
}

export { MAX_REDIRECTS, MAX_STACK, CYCLE_WINDOW, CYCLE_THRESHOLD, MAX_URL_LENGTH };
