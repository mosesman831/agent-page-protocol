/**
 * CSRF Origin priority checks per SPEC §10.2 / §3.4.1.
 *
 * Origin takes PRIORITY. X-APP-Origin is evaluated only when Origin is absent.
 * Mismatched Origin + valid X-APP-Origin → 403 (TV-44).
 * X-APP-Origin path requires valid non-cookie auth (Authorization and/or X-API-Key).
 */

import { HEADER_APP_ORIGIN } from './media-types.js';

export interface CsrfCheckInput {
  method: string;
  origin?: string | null;
  appOrigin?: string | null;
  /** Scheme+host+port of the page that advertised the action. */
  pageOrigin: string;
  /**
   * Whether the request carries valid non-cookie auth (Authorization / X-API-Key).
   * Required when accepting X-APP-Origin with Origin absent (§10.2 / §3.4.1).
   */
  hasValidAuth?: boolean;
  /** When true, skip CSRF for safe methods (default). */
  enforceOnSafeMethods?: boolean;
}

export interface CsrfCheckResult {
  ok: boolean;
  code?: 'app.err.security.csrf' | 'app.err.security.origin';
  message?: string;
  /** Which header was authoritative for the decision. */
  used?: 'Origin' | 'X-APP-Origin' | 'none';
}

export function extractOriginFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Normalize origin string (scheme://host[:port]) for comparison.
 */
export function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.trim().replace(/\/$/, '');
  }
}

/**
 * Normative CSRF check for POST actions.
 */
export function checkCsrf(input: CsrfCheckInput): CsrfCheckResult {
  const method = input.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    if (!input.enforceOnSafeMethods) {
      return { ok: true, used: 'none' };
    }
  }

  const pageOrigin = normalizeOrigin(input.pageOrigin);
  const originHeader = input.origin?.trim() || null;
  const xaoHeader = input.appOrigin?.trim() || null;

  // Origin takes PRIORITY when present
  if (originHeader) {
    const origin = normalizeOrigin(originHeader);
    if (origin !== pageOrigin) {
      return {
        ok: false,
        code: 'app.err.security.csrf',
        message: 'Origin header does not match page origin',
        used: 'Origin',
      };
    }
    return { ok: true, used: 'Origin' };
  }

  // Origin absent → evaluate X-APP-Origin
  if (!xaoHeader) {
    return {
      ok: false,
      code: 'app.err.security.csrf',
      message: 'Missing Origin and X-APP-Origin',
      used: 'none',
    };
  }

  const xao = normalizeOrigin(xaoHeader);
  if (xao !== pageOrigin) {
    return {
      ok: false,
      code: 'app.err.security.csrf',
      message: 'X-APP-Origin does not match page origin',
      used: 'X-APP-Origin',
    };
  }

  // Spec §10.2 / §3.4.1: X-APP-Origin only with valid non-cookie auth
  if (input.hasValidAuth === false) {
    return {
      ok: false,
      code: 'app.err.security.csrf',
      message: 'X-APP-Origin requires valid non-cookie authentication credentials',
      used: 'X-APP-Origin',
    };
  }

  return { ok: true, used: 'X-APP-Origin' };
}

export function readCsrfHeaders(headers: Record<string, string | string[] | undefined>): {
  origin: string | null;
  appOrigin: string | null;
} {
  const get = (name: string): string | null => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };
  return {
    origin: get('origin'),
    appOrigin: get(HEADER_APP_ORIGIN) ?? get(HEADER_APP_ORIGIN.toLowerCase()),
  };
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** True if any credentials are present (Cookie, Authorization, or X-API-Key). */
export function hasAuthCredentials(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const auth = headerValue(headers, 'authorization');
  const cookie = headerValue(headers, 'cookie');
  const apiKey = headerValue(headers, 'x-api-key');
  return Boolean(
    (auth && auth.length > 0) || (cookie && cookie.length > 0) || (apiKey && apiKey.length > 0),
  );
}

/**
 * True iff Authorization and/or X-API-Key is present (non-empty).
 * Cookie alone is insufficient for the X-APP-Origin CSRF path (§10.2 / §3.4.1).
 */
export function hasNonCookieAuth(headers: Record<string, string | string[] | undefined>): boolean {
  const auth = headerValue(headers, 'authorization');
  const apiKey = headerValue(headers, 'x-api-key');
  return Boolean((auth && auth.length > 0) || (apiKey && apiKey.length > 0));
}
