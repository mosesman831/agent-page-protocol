/**
 * APP HTTP client helpers — Accept headers, auth hooks, rate limits, origin
 * (SPEC v0.4-Ultimate §3, §9, §10).
 */

import {
  ACCEPT_ACTION,
  ACCEPT_GET,
  HEADER_APP_ACCEPT_VERSIONS,
  HEADER_APP_ACCESS_TOKEN,
  HEADER_APP_ACCESS_TOKEN_TTL,
  HEADER_APP_CHALLENGE,
  HEADER_APP_CLIENT,
  HEADER_APP_CONFIRMATION,
  HEADER_APP_HOLD_TOKEN,
  HEADER_APP_IDEMPOTENCY_KEY,
  HEADER_APP_IF_MATCH_VERSION,
  HEADER_APP_ORIGIN,
  HEADER_APP_REFRESH_TOKEN,
  HEADER_APP_REQUEST_ID,
  HEADER_APP_RESPONSE_MODE,
  HEADER_APP_RESULT_VERSION,
  HEADER_APP_RESUME,
  HEADER_APP_NAVIGATE,
  HEADER_APP_VERSION,
  HEADER_APP_CSRF,
  HEADER_SET_APP_RESUME,
  MEDIA_ACTION,
  MEDIA_DIFF,
  MEDIA_ERROR,
  MEDIA_EVENT_STREAM,
  MEDIA_PAGE,
  parseMediaType,
} from './media-types.js';
import { AppError, isErrorEnvelope } from './errors.js';
import { extractOrigin } from './navigate.js';
import type { ErrorEnvelope } from './types.js';

export type FetchLike = typeof fetch;

export type GetAuthHeaders = () => Record<string, string> | Promise<Record<string, string>>;

export type OnAuthRefresh = () => boolean | Promise<boolean>;

export type GetResumeToken = (url: string) => string | undefined;

export interface AppHttpOptions {
  fetch?: FetchLike;
  getAuthHeaders?: GetAuthHeaders;
  onAuthRefresh?: OnAuthRefresh;
  getResumeToken?: GetResumeToken;
  clientName?: string;
  clientVersion?: string;
  /** Default X-APP-Client kind — agents MUST use 'agent' (§10.4). */
  clientKind?: 'agent' | 'renderer' | 'extension';
  /** Auto-wait once on 429 Retry-After (TV-48). Default true. */
  honorRetryAfter?: boolean;
}

export interface AppResponseMeta {
  status: number;
  mediaType: string | null;
  responseMode: string | null;
  requestId: string | null;
  etag: string | null;
  cacheControl: string | null;
  location: string | null;
  navigate: string | null;
  resultVersion: string | null;
  retryAfterMs: number | null;
  headers: Headers;
  setAppResume: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenTtl: number | null;
}

function isAppErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (isErrorEnvelope(body)) return true;
  if (!body || typeof body !== 'object') return false;
  const e = body as ErrorEnvelope;
  return (
    (e.app === '1.0' || e.app === '1.1') &&
    !!e.error &&
    typeof e.error.code === 'string' &&
    typeof e.error.message === 'string'
  );
}

function clientHeader(kind: string, version: string): string {
  return `${kind}/${version}`;
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

/**
 * Parse Retry-After (delta-seconds or HTTP-date) and RateLimit reset (§10.6).
 */
export function parseRetryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const asInt = Number(retryAfter);
    if (Number.isFinite(asInt) && asInt >= 0) {
      return Math.ceil(asInt * 1000);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - Date.now());
    }
  }

  // Modern RateLimit: default;limit=60;remaining=42;reset=28  (reset = delta-seconds)
  const rateLimit = headers.get('ratelimit') ?? headers.get('rate-limit');
  if (rateLimit) {
    const m = /(?:^|[;,]\s*)reset=(\d+)/i.exec(rateLimit);
    if (m) {
      const sec = Number(m[1]);
      if (Number.isFinite(sec)) return Math.ceil(sec * 1000);
    }
  }

  // Legacy X-RateLimit-Reset = epoch seconds
  const legacyReset = headers.get('x-ratelimit-reset');
  if (legacyReset) {
    const epoch = Number(legacyReset);
    if (Number.isFinite(epoch) && epoch > 1e9) {
      return Math.max(0, Math.ceil(epoch * 1000 - Date.now()));
    }
    if (Number.isFinite(epoch) && epoch < 1e9) {
      // treat as delta if small
      return Math.ceil(epoch * 1000);
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class AppHttpClient {
  readonly fetch: FetchLike;
  private readonly getAuthHeaders?: GetAuthHeaders;
  private readonly onAuthRefresh?: OnAuthRefresh;
  private readonly getResumeToken?: GetResumeToken;
  private readonly clientKind: string;
  private readonly clientVersion: string;
  private readonly clientName?: string;
  private readonly honorRetryAfter: boolean;
  /** Ensures auth refresh runs at most once per request chain (TV-49). */
  private refreshing = false;

  constructor(options: AppHttpOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.getAuthHeaders = options.getAuthHeaders;
    this.onAuthRefresh = options.onAuthRefresh;
    this.getResumeToken = options.getResumeToken;
    this.clientKind = options.clientKind ?? 'agent';
    this.clientVersion = options.clientVersion ?? '0.4.0';
    this.clientName = options.clientName;
    this.honorRetryAfter = options.honorRetryAfter !== false;
  }

  async authHeaders(): Promise<Record<string, string>> {
    if (!this.getAuthHeaders) return {};
    return (await this.getAuthHeaders()) ?? {};
  }

  originHeaders(pageUrl: string): Record<string, string> {
    const origin = extractOrigin(pageUrl);
    return {
      Origin: origin,
      [HEADER_APP_ORIGIN]: origin,
    };
  }

  baseHeaders(pageUrl?: string): Record<string, string> {
    const h: Record<string, string> = {
      [HEADER_APP_CLIENT]: clientHeader(this.clientKind, this.clientVersion),
      [HEADER_APP_VERSION]: '1.1',
      [HEADER_APP_ACCEPT_VERSIONS]: '1.1, 1.0',
      'Accept-Language': 'en',
    };
    if (this.clientName) {
      h['X-APP-Client-Name'] = this.clientName;
    }
    if (pageUrl) {
      Object.assign(h, this.originHeaders(pageUrl));
    }
    return h;
  }

  parseMeta(res: Response): AppResponseMeta {
    const ttlRaw = res.headers.get(HEADER_APP_ACCESS_TOKEN_TTL);
    const ttl = ttlRaw != null ? Number(ttlRaw) : NaN;
    return {
      status: res.status,
      mediaType: parseMediaType(res.headers.get('content-type')),
      responseMode: res.headers.get(HEADER_APP_RESPONSE_MODE),
      requestId: res.headers.get(HEADER_APP_REQUEST_ID),
      etag: res.headers.get('etag'),
      cacheControl: res.headers.get('cache-control'),
      location: res.headers.get('location'),
      navigate: res.headers.get(HEADER_APP_NAVIGATE),
      resultVersion: res.headers.get(HEADER_APP_RESULT_VERSION),
      retryAfterMs: parseRetryAfterMs(res.headers),
      headers: res.headers,
      setAppResume: res.headers.get(HEADER_SET_APP_RESUME),
      accessToken: res.headers.get(HEADER_APP_ACCESS_TOKEN),
      refreshToken: res.headers.get(HEADER_APP_REFRESH_TOKEN),
      accessTokenTtl: Number.isFinite(ttl) ? ttl : null,
    };
  }

  async parseJsonBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AppError('app.err.payload.invalid_json', {
        message: 'Response body is not valid JSON',
        httpStatus: res.status,
        request_id: res.headers.get(HEADER_APP_REQUEST_ID) ?? undefined,
      });
    }
  }

  /**
   * Throw AppError from error envelope or generic HTTP failure.
   * Extracts confirmation_challenge from details StateNode when present (§10.4).
   */
  throwIfError(body: unknown, meta: AppResponseMeta): void {
    if (meta.mediaType === MEDIA_ERROR || isAppErrorEnvelope(body)) {
      if (isAppErrorEnvelope(body)) {
        const details = body.error.details ?? {};
        const challengeNode = details.confirmation_challenge as
          { type?: string; value?: string } | undefined;
        if (challengeNode?.value && !body.error.confirmation_challenge) {
          body.error.confirmation_challenge = challengeNode.value;
        }
        if (body.error.retry_after_ms === undefined && meta.retryAfterMs !== null) {
          body.error.retry_after_ms = meta.retryAfterMs;
        }
        throw AppError.fromEnvelope(body, meta.status);
      }
    }
    if (meta.status >= 400) {
      const code =
        meta.status === 401
          ? 'app.err.auth.required'
          : meta.status === 404
            ? 'app.err.page.not_found'
            : meta.status === 410
              ? 'app.err.page.gone'
              : meta.status === 405
                ? 'app.err.transport.method_not_allowed'
                : meta.status === 415
                  ? 'app.err.negotiate.unsupported_media_type'
                  : meta.status === 429
                    ? 'app.err.rate.limited'
                    : meta.status === 504
                      ? 'app.err.transport.timeout'
                      : 'app.err.internal.server';
      throw new AppError(code, {
        httpStatus: meta.status,
        request_id: meta.requestId ?? undefined,
        message: `HTTP ${meta.status}`,
        retry_after_ms: meta.retryAfterMs ?? undefined,
      });
    }
  }

  /**
   * Fetch with auth headers + single 401 refresh (TV-49) + 429 Retry-After wait (TV-48).
   */
  async request(
    url: string,
    init: RequestInit & { pageUrl?: string; _retried429?: boolean } = {},
  ): Promise<{ res: Response; meta: AppResponseMeta; body: unknown }> {
    const pageUrl = init.pageUrl ?? url;
    const doFetch = async (): Promise<Response> => {
      const auth = await this.authHeaders();
      const headers = new Headers(init.headers);
      for (const [k, v] of Object.entries(this.baseHeaders(pageUrl))) {
        if (!headers.has(k)) headers.set(k, v);
      }
      for (const [k, v] of Object.entries(auth)) {
        headers.set(k, v);
      }
      if (!headers.has(HEADER_APP_RESUME) && this.getResumeToken) {
        const token = this.getResumeToken(pageUrl);
        if (token) headers.set(HEADER_APP_RESUME, token);
      }
      // K3 MF-9: echo app_csrf cookie to X-APP-CSRF on cookie-authenticated POSTs.
      const method = String(init.method ?? 'GET').toUpperCase();
      if (method === 'POST' && !headers.has(HEADER_APP_CSRF)) {
        const cookie = headers.get('Cookie') ?? headers.get('cookie');
        const csrf = readCookie(cookie, 'app_csrf');
        if (csrf) headers.set(HEADER_APP_CSRF, csrf);
      }
      const { pageUrl: _p, _retried429: _r, ...rest } = init;
      return this.fetch(url, { ...rest, headers });
    };

    let res = await doFetch();
    let meta = this.parseMeta(res);

    // Single auth refresh then surface (TV-49)
    if (meta.status === 401 && this.onAuthRefresh && !this.refreshing) {
      this.refreshing = true;
      try {
        const ok = await this.onAuthRefresh();
        if (ok) {
          res = await doFetch();
          meta = this.parseMeta(res);
        }
      } finally {
        this.refreshing = false;
      }
    }

    // Honor Retry-After once on 429 (TV-48)
    if (
      meta.status === 429 &&
      this.honorRetryAfter &&
      !init._retried429 &&
      meta.retryAfterMs !== null
    ) {
      await sleep(meta.retryAfterMs);
      return this.request(url, { ...init, _retried429: true });
    }

    // 304 / 204 have no body
    if (meta.status === 304 || meta.status === 204) {
      return { res, meta, body: null };
    }

    // 303/302/301 may have empty body
    if (
      (meta.status === 303 || meta.status === 302 || meta.status === 301 || meta.status === 201) &&
      !res.headers.get('content-type')
    ) {
      const text = await res.text();
      return {
        res,
        meta,
        body: text
          ? (() => {
              try {
                return JSON.parse(text);
              } catch {
                return text;
              }
            })()
          : null,
      };
    }

    const body = await this.parseJsonBody(res);

    if (meta.status === 401) {
      this.throwIfError(body, meta);
    }

    return { res, meta, body };
  }

  async get(
    url: string,
    options: {
      ifNoneMatch?: string;
      ifMatchVersion?: string;
      pageUrl?: string;
      extraHeaders?: Record<string, string>;
      resumeToken?: string;
    } = {},
  ): Promise<{ res: Response; meta: AppResponseMeta; body: unknown }> {
    const headers: Record<string, string> = {
      Accept: ACCEPT_GET,
      ...(options.extraHeaders ?? {}),
    };
    if (options.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch;
    if (options.ifMatchVersion) {
      headers[HEADER_APP_IF_MATCH_VERSION] = options.ifMatchVersion;
    }
    if (options.resumeToken) headers[HEADER_APP_RESUME] = options.resumeToken;
    return this.request(url, {
      method: 'GET',
      headers,
      pageUrl: options.pageUrl ?? url,
      redirect: 'manual',
    });
  }

  /**
   * GET text/event-stream with Authorization (agents MUST NOT use EventSource).
   */
  async getEventStream(
    url: string,
    options: {
      pageUrl?: string;
      extraHeaders?: Record<string, string>;
      resumeToken?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<Response> {
    const pageUrl = options.pageUrl ?? url;
    const auth = await this.authHeaders();
    const headers = new Headers(options.extraHeaders);
    for (const [k, v] of Object.entries(this.baseHeaders(pageUrl))) {
      if (!headers.has(k)) headers.set(k, v);
    }
    for (const [k, v] of Object.entries(auth)) headers.set(k, v);
    if (!headers.has('Accept')) headers.set('Accept', MEDIA_EVENT_STREAM);
    const resume = options.resumeToken ?? this.getResumeToken?.(pageUrl);
    if (resume && !headers.has(HEADER_APP_RESUME)) headers.set(HEADER_APP_RESUME, resume);
    return this.fetch(url, {
      method: 'GET',
      headers,
      signal: options.signal,
      redirect: 'manual',
    });
  }

  /**
   * Raw GET of a file-node URL with auth + resume headers. Never follows
   * redirects itself (redirect:'manual'); file.ts handles same-origin hops.
   */
  async getFile(
    url: string,
    options: {
      pageUrl?: string;
      extraHeaders?: Record<string, string>;
      resumeToken?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<Response> {
    const pageUrl = options.pageUrl ?? url;
    const auth = await this.authHeaders();
    const headers = new Headers(options.extraHeaders);
    for (const [k, v] of Object.entries(this.baseHeaders(pageUrl))) {
      if (!headers.has(k)) headers.set(k, v);
    }
    for (const [k, v] of Object.entries(auth)) headers.set(k, v);
    const resume = options.resumeToken ?? this.getResumeToken?.(pageUrl);
    if (resume && !headers.has(HEADER_APP_RESUME)) headers.set(HEADER_APP_RESUME, resume);
    return this.fetch(url, {
      method: 'GET',
      headers,
      signal: options.signal,
      redirect: 'manual',
    });
  }

  /**
   * POST action. Prefer `rawBody` for Mode A confirmation re-POST (identical bytes, C10).
   */
  async postAction(
    url: string,
    body: unknown,
    options: {
      pageUrl: string;
      ifMatchVersion?: string;
      idempotencyKey?: string;
      confirmation?: string;
      extraHeaders?: Record<string, string>;
      /** Exact raw body bytes/string — Mode A MUST reuse identical bytes. */
      rawBody?: string;
      resumeToken?: string;
      challenge?: string;
      holdToken?: string;
    },
  ): Promise<{ res: Response; meta: AppResponseMeta; body: unknown; rawBody: string }> {
    const rawBody = options.rawBody ?? JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: ACCEPT_ACTION,
      'Content-Type': MEDIA_ACTION,
      ...(options.extraHeaders ?? {}),
    };
    if (options.ifMatchVersion) {
      headers[HEADER_APP_IF_MATCH_VERSION] = options.ifMatchVersion;
    }
    if (options.idempotencyKey) {
      headers[HEADER_APP_IDEMPOTENCY_KEY] = options.idempotencyKey;
    }
    if (options.resumeToken) headers[HEADER_APP_RESUME] = options.resumeToken;
    if (options.challenge) headers[HEADER_APP_CHALLENGE] = options.challenge;
    if (options.holdToken) headers[HEADER_APP_HOLD_TOKEN] = options.holdToken;
    if (options.confirmation) {
      // Agents NEVER use Mode B uuid-mode: (§10.4)
      if (this.clientKind === 'agent' && options.confirmation.startsWith('uuid-mode:')) {
        throw new AppError('app.err.action.confirmation_invalid', {
          message: 'Agents must not use Mode B uuid-mode confirmation',
        });
      }
      headers[HEADER_APP_CONFIRMATION] = options.confirmation;
    }
    const result = await this.request(url, {
      method: 'POST',
      headers,
      body: rawBody,
      pageUrl: options.pageUrl,
      redirect: 'manual',
    });
    return { ...result, rawBody };
  }
}

export {
  ACCEPT_GET,
  ACCEPT_ACTION,
  MEDIA_PAGE,
  MEDIA_DIFF,
  MEDIA_ERROR,
  MEDIA_ACTION,
  HEADER_APP_CONFIRMATION,
  HEADER_APP_IDEMPOTENCY_KEY,
  HEADER_APP_IF_MATCH_VERSION,
  HEADER_APP_RESPONSE_MODE,
  HEADER_APP_RESULT_VERSION,
  HEADER_APP_NAVIGATE,
  HEADER_APP_VERSION,
  HEADER_APP_ACCEPT_VERSIONS,
};
