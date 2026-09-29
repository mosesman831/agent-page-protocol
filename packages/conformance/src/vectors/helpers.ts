/**
 * Shared helpers for conformance vectors.
 */

import { request as httpRequest } from 'node:http';
import { MEDIA_PAGE, MEDIA_DIFF, MEDIA_ACTION, MEDIA_ERROR } from '@agent-page/server';

export { MEDIA_PAGE, MEDIA_DIFF, MEDIA_ACTION, MEDIA_ERROR };

/** GET page loads — v=1.0 media params per SPEC §3.1. KEEP for TV-01..60. */
export const ACCEPT_PAGE = `${MEDIA_PAGE};v=1.0`;
export const ACCEPT_DIFF = `${MEDIA_DIFF};v=1.0;q=1.0, ${MEDIA_PAGE};v=1.0;q=0.9, ${MEDIA_ERROR};v=1.0;q=0.8`;
export const ACCEPT_ANY_APP = `${MEDIA_DIFF};v=1.0, ${MEDIA_PAGE};v=1.0, ${MEDIA_ERROR};v=1.0`;
export const ACCEPT_DIFF_ONLY = `${MEDIA_DIFF};v=1.0;q=1.0, ${MEDIA_ERROR};v=1.0;q=0.8`;

/** 1.1 Accept without forcing v=1.1-only (SPEC §27 / §35). */
export const ACCEPT_PAGE_11 = MEDIA_PAGE;
export const ACCEPT_DIFF_11 = `${MEDIA_DIFF}, ${MEDIA_PAGE}, ${MEDIA_ERROR}`;
export const ACCEPT_VERSIONS_11 = '1.1, 1.0';
export const HEADER_ACCEPT_VERSIONS = 'X-APP-Accept-Versions';

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text.length === 0 ? null : JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON body, got: ${text.slice(0, 200)}`);
  }
}

export async function readTextAndJson(res: Response): Promise<{ text: string; json: unknown }> {
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { text, json };
}

/**
 * Expand Level-1 `{var}` URL templates (§8.3).
 * Path segments use encodeURIComponent; query uses form encoding (prefer %20).
 */
export function expandUrlTemplate(template: string, params: Record<string, unknown>): string {
  const qIndex = template.indexOf('?');
  const pathTpl = qIndex >= 0 ? template.slice(0, qIndex) : template;
  const queryTpl = qIndex >= 0 ? template.slice(qIndex + 1) : null;

  const expand = (tpl: string, inQuery: boolean): string =>
    tpl.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, key: string) => {
      if (!(key in params)) {
        throw new Error(`Missing template param: ${key}`);
      }
      const raw = params[key];
      const str =
        typeof raw === 'boolean'
          ? raw
            ? 'true'
            : 'false'
          : raw === null || raw === undefined
            ? ''
            : String(raw);
      if (inQuery) {
        return encodeURIComponent(str).replace(/%20/g, '%20');
      }
      return encodeURIComponent(str);
    });

  const path = expand(pathTpl, false);
  if (queryTpl == null) return path;
  return `${path}?${expand(queryTpl, true)}`;
}

export function errorCode(body: unknown): string | undefined {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'code' in body.error
  ) {
    return String((body.error as { code: unknown }).code);
  }
  return undefined;
}

export function errorPath(body: unknown): string | undefined {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'path' in body.error
  ) {
    const p = (body.error as { path: unknown }).path;
    return p == null ? undefined : String(p);
  }
  return undefined;
}

/** Conformance route for vector N (1-based). */
export function tvPath(number: number): string {
  return `/vectors/tv-${String(number).padStart(2, '0')}`;
}

export function actionHeaders(
  ctx: { origin: string },
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Accept: ACCEPT_DIFF,
    'Content-Type': MEDIA_ACTION,
    Origin: ctx.origin,
    ...extra,
  };
}

/** Headers for 1.1 GETs: Accept-Versions 1.1,1.0 without forcing v=1.1-only. */
export function v11GetHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: ACCEPT_PAGE_11,
    [HEADER_ACCEPT_VERSIONS]: ACCEPT_VERSIONS_11,
    ...extra,
  };
}

/** Headers for 1.1 POSTs. */
export function v11ActionHeaders(
  ctx: { origin: string },
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Accept: ACCEPT_DIFF_11,
    'Content-Type': MEDIA_ACTION,
    Origin: ctx.origin,
    [HEADER_ACCEPT_VERSIONS]: ACCEPT_VERSIONS_11,
    ...extra,
  };
}

export function sessionCookie(res: Response): string | undefined {
  const raw = res.headers.getSetCookie?.() ?? [];
  const list = raw.length > 0 ? raw : [res.headers.get('set-cookie') ?? ''];
  for (const line of list) {
    const m = /(?:^|,\s*)session=([^;]+)/i.exec(line);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export function headerAccessToken(res: Response): string | undefined {
  return res.headers.get('x-app-access-token') ?? undefined;
}

export function containsLeakedSecret(text: string): boolean {
  if (/correct-horse/.test(text)) return true;
  if (/"access_token"\s*:/.test(text)) return true;
  if (/\beyJ[A-Za-z0-9_-]{8,}\b/.test(text)) return true;
  return false;
}

/** Simple HTTP GET via node:http (fallback when fetch fails). */
export function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    )
      .on('error', reject)
      .end();
  });
}

/** Send GET with body via raw HTTP (fetch disallows bodies on GET). */
export function getWithBody(
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          ...headers,
          'Content-Length': String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
