/** APP media type constants (SPEC §3.1, §3.9, v0.5-extreme §19). */

export const APP_VERSION = '1.0' as const;
export const APP_VERSION_11 = '1.1' as const;
export const MAX_PROTOCOL_VERSION = '1.1' as const;
export const SUPPORTED_PROTOCOL_VERSIONS = ['1.0', '1.1'] as const;

export const MEDIA_PAGE = 'application/vnd.agent-page+json';
export const MEDIA_DIFF = 'application/vnd.agent-page-diff+json';
export const MEDIA_ERROR = 'application/vnd.agent-page-error+json';
export const MEDIA_ACTION = 'application/vnd.agent-page-action+json';
export const MEDIA_EVENT = 'application/vnd.agent-page-event+json';
export const MEDIA_EVENT_STREAM = 'text/event-stream';

export const HEADER_APP_VERSION = 'X-APP-Version';
export const HEADER_APP_PAGE_ID = 'X-APP-Page-Id';
export const HEADER_APP_RESPONSE_MODE = 'X-APP-Response-Mode';
export const HEADER_APP_REQUEST_ID = 'X-APP-Request-Id';
export const HEADER_APP_CLIENT = 'X-APP-Client';
export const HEADER_APP_IDEMPOTENCY_KEY = 'X-APP-Idempotency-Key';
export const HEADER_APP_IF_MATCH_VERSION = 'X-APP-If-Match-Version';
export const HEADER_APP_CONFIRMATION = 'X-APP-Confirmation';
export const HEADER_APP_ORIGIN = 'X-APP-Origin';
export const HEADER_APP_NAVIGATE = 'X-APP-Navigate';
export const HEADER_APP_CSRF = 'X-APP-CSRF';
export const HEADER_APP_ACCEPT_VERSIONS = 'X-APP-Accept-Versions';
export const HEADER_APP_RESULT_VERSION = 'X-APP-Result-Version';
export const HEADER_APP_CHALLENGE = 'X-APP-Challenge';
export const HEADER_APP_HOLD_TOKEN = 'X-APP-Hold-Token';
export const HEADER_APP_RESUME = 'X-APP-Resume';
export const HEADER_SET_APP_RESUME = 'Set-APP-Resume';
export const HEADER_APP_ACCESS_TOKEN = 'X-APP-Access-Token';
export const HEADER_APP_REFRESH_TOKEN = 'X-APP-Refresh-Token';
export const HEADER_APP_ACCESS_TOKEN_TTL = 'X-APP-Access-Token-TTL';
export const HEADER_APP_LOCALE = 'X-APP-Locale';
export const HEADER_APP_TIME_ZONE = 'X-APP-Time-Zone';
export const HEADER_APP_DEVICE = 'X-APP-Device';

export type AppResponseMode = 'full' | 'diff' | 'redirect' | 'error' | 'async' | 'event';

/** Strip parameters (e.g. charset) from a Content-Type / Accept media type. */
export function parseMediaType(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  return base.length > 0 ? base : null;
}

/** Parse Accept/Content-Type parameters (e.g. v=1.0, q=0.9, charset=utf-8). */
export function parseMediaParams(raw: string | undefined | null): Record<string, string> {
  if (!raw) return {};
  const parts = raw.split(';').slice(1);
  const out: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let val = part.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function isAppSuccessMediaType(type: string): boolean {
  return type === MEDIA_PAGE || type === MEDIA_DIFF;
}

export function isAppMediaType(type: string): boolean {
  return (
    type === MEDIA_PAGE ||
    type === MEDIA_DIFF ||
    type === MEDIA_ERROR ||
    type === MEDIA_ACTION ||
    type === MEDIA_EVENT
  );
}

export function isSupportedProtocolVersion(v: string): v is '1.0' | '1.1' {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);
}

export function compareProtocolVersions(a: string, b: string): number {
  const [am, an] = a.split('.').map((n) => Number(n));
  const [bm, bn] = b.split('.').map((n) => Number(n));
  const aMaj = Number.isFinite(am) ? am! : 0;
  const aMin = Number.isFinite(an) ? an! : 0;
  const bMaj = Number.isFinite(bm) ? bm! : 0;
  const bMin = Number.isFinite(bn) ? bn! : 0;
  if (aMaj !== bMaj) return aMaj - bMaj;
  return aMin - bMin;
}
