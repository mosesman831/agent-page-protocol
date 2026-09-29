/**
 * SSE + long-poll event channel (SPEC §14).
 * Heartbeat 15-30s. Auth failure: 401 envelope NOT a stream.
 * Unknown page_url 404. Cross-origin page_url 403 security.cross_origin.
 * GET only; POST => 405.
 * Last-Event-ID / after: replay after id, min(100 events, 15 min);
 * unknown id skips replay (not 400).
 * MF-6b: SSE reconnect with invalid X-APP-Resume => 401 auth.expired envelope (not a stream).
 * Long-poll: timeout_ms 1000..30000 default 25000; 204 if none.
 */

import { AppError, buildErrorEnvelope, resolveHttpStatus } from './errors.js';
import { MEDIA_EVENT, MEDIA_EVENT_STREAM } from './media-types.js';
import type { AppProtocolVersion, ErrorEnvelope, EventRecord, EventRecordBody } from './types.js';

export const HEARTBEAT_MIN_MS = 15_000;
export const HEARTBEAT_MAX_MS = 30_000;
export const HEARTBEAT_DEFAULT_MS = 15_000;
export const LONGPOLL_TIMEOUT_MIN_MS = 1_000;
export const LONGPOLL_TIMEOUT_MAX_MS = 30_000;
export const LONGPOLL_TIMEOUT_DEFAULT_MS = 25_000;
export const EVENT_REPLAY_MAX = 100;
export const EVENT_REPLAY_WINDOW_MS = 15 * 60 * 1000;
export const EVENT_MEDIA_TYPE = MEDIA_EVENT;
export const SSE_MEDIA_TYPE = MEDIA_EVENT_STREAM;

export function clampHeartbeatInterval(ms?: number): number {
  const v = ms ?? HEARTBEAT_DEFAULT_MS;
  if (!Number.isFinite(v)) return HEARTBEAT_DEFAULT_MS;
  return Math.min(HEARTBEAT_MAX_MS, Math.max(HEARTBEAT_MIN_MS, Math.floor(v)));
}

export function clampLongpollTimeout(ms?: number): number {
  const v = ms ?? LONGPOLL_TIMEOUT_DEFAULT_MS;
  if (!Number.isFinite(v)) return LONGPOLL_TIMEOUT_DEFAULT_MS;
  return Math.min(LONGPOLL_TIMEOUT_MAX_MS, Math.max(LONGPOLL_TIMEOUT_MIN_MS, Math.floor(v)));
}

export function parseLongpollTimeout(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return LONGPOLL_TIMEOUT_DEFAULT_MS;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new AppError('app.err.events.mode', { message: 'timeout_ms is invalid' });
  }
  if (n < LONGPOLL_TIMEOUT_MIN_MS || n > LONGPOLL_TIMEOUT_MAX_MS) {
    throw new AppError('app.err.events.mode', {
      message: `timeout_ms must be ${LONGPOLL_TIMEOUT_MIN_MS}..${LONGPOLL_TIMEOUT_MAX_MS}`,
    });
  }
  return Math.floor(n);
}

export interface StoredEvent {
  record: EventRecord;
  occurredAtMs: number;
}

export interface EventStore {
  append(record: EventRecord): Promise<void>;
  list(pageUrl: string): Promise<StoredEvent[]>;
  pageExists(pageUrl: string): Promise<boolean>;
}

export class MemoryEventStore implements EventStore {
  private readonly byPage = new Map<string, StoredEvent[]>();
  private readonly knownPages = new Set<string>();

  registerPage(pageUrl: string): void {
    this.knownPages.add(pageUrl);
  }

  async pageExists(pageUrl: string): Promise<boolean> {
    return this.knownPages.has(pageUrl) || this.byPage.has(pageUrl);
  }

  async append(record: EventRecord): Promise<void> {
    const invalid = validateEventRecord(record);
    if (invalid) throw invalid;
    const pageUrl = record.event.page_url;
    const list = this.byPage.get(pageUrl) ?? [];
    list.push({ record, occurredAtMs: Date.parse(record.event.occurred_at) || Date.now() });
    this.byPage.set(pageUrl, list);
    this.knownPages.add(pageUrl);
  }

  async list(pageUrl: string): Promise<StoredEvent[]> {
    return this.byPage.get(pageUrl) ?? [];
  }

  clear(): void {
    this.byPage.clear();
    this.knownPages.clear();
  }
}

export function sameOrigin(pageUrl: string, origin: string): boolean {
  try {
    return new URL(pageUrl).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function formatSseMessage(record: EventRecord): string {
  const data = JSON.stringify(record);
  return `id: ${record.event.id}\nevent: ${record.event.type}\ndata: ${data}\n\n`;
}

export function formatSseRetry(retryMs = 3000): string {
  return `retry: ${retryMs}\n`;
}

// Emit-time validation for event records (mirrors schema/event.json): a
// server MUST NOT emit an event document the schema forbids.
const EVENT_MEMBERS = new Set([
  'id',
  'type',
  'page_id',
  'page_url',
  'version',
  'occurred_at',
  'base_version',
  'hint',
  'diff',
  'pointers',
]);
const EVENT_TYPES = new Set([
  'state.changed',
  'page.replaced',
  'action.completed',
  'session.expired',
  'hold.cleared',
  'challenge.updated',
  'order.updated',
  'consent.changed',
  'heartbeat',
]);
const EVENT_HINTS = new Set(['revalidate', 'diff', 'drop']);
const EVENT_FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function eventForbiddenIn(value: unknown, path: string): AppError | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const err = eventForbiddenIn(value[i], `${path}/${i}`);
      if (err) return err;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (EVENT_FORBIDDEN.has(k))
        return new AppError('app.err.event.invalid', {
          message: `Forbidden key: ${k}`,
          path: `${path}/${k}`,
        });
      const err = eventForbiddenIn(v, `${path}/${k}`);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Emit-time event validation. Returns null when the record is servable, else
 * an AppError describing the violation. `MemoryEventStore.append` applies it
 * so malformed records never reach SSE/long-poll subscribers.
 */
export function validateEventRecord(record: unknown): AppError | null {
  const fail = (message: string, path = '/event'): AppError =>
    new AppError('app.err.event.invalid', { message, path });
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return fail('Event record must be an object', '/');
  }
  const rec = record as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (k !== 'app' && k !== 'event') return fail(`Unexpected member: ${k}`, `/${k}`);
  }
  if (rec.app !== '1.0' && rec.app !== '1.1') return fail('app must be "1.0" or "1.1"', '/app');
  const ev = rec.event;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return fail('event must be an object');
  const body = ev as Record<string, unknown>;
  for (const k of Object.keys(body)) {
    if (!EVENT_MEMBERS.has(k)) return fail(`Unexpected event member: ${k}`, `/event/${k}`);
  }
  for (const [k, t] of [
    ['id', 'string'],
    ['page_id', 'string'],
    ['page_url', 'string'],
    ['version', 'string'],
    ['occurred_at', 'string'],
  ] as const) {
    if (typeof body[k] !== t || (body[k] as string).length === 0)
      return fail(`event.${k} must be a non-empty string`, `/event/${k}`);
  }
  if (typeof body.id === 'string' && body.id.length > 128)
    return fail('event.id exceeds 128 chars', '/event/id');
  if (typeof body.type !== 'string' || !EVENT_TYPES.has(body.type))
    return fail('event.type not in enum', '/event/type');
  if (!EVENT_HINTS.has(body.hint as string)) return fail('event.hint not in enum', '/event/hint');
  if (Number.isNaN(Date.parse(body.occurred_at as string)))
    return fail('event.occurred_at is not a valid date-time', '/event/occurred_at');
  if (body.base_version !== undefined && typeof body.base_version !== 'string')
    return fail('event.base_version must be a string', '/event/base_version');
  if (body.pointers !== undefined && !Array.isArray(body.pointers))
    return fail('event.pointers must be an array', '/event/pointers');
  return eventForbiddenIn(rec, '');
}

export function heartbeatEvent(opts: {
  app?: AppProtocolVersion;
  pageId: string;
  pageUrl: string;
  version: string;
  now?: Date;
}): EventRecord {
  const occurred = (opts.now ?? new Date()).toISOString();
  const body: EventRecordBody = {
    id: `evt_hb_${Date.now()}`,
    type: 'heartbeat',
    page_id: opts.pageId,
    page_url: opts.pageUrl,
    version: opts.version,
    occurred_at: occurred,
    hint: 'revalidate',
  };
  return { app: opts.app ?? '1.1', event: body };
}

/**
 * Replay events after `afterId`, limited to min(100 events, 15 minutes).
 * Unknown id: skip replay (empty list), MUST NOT 400.
 */
export function replayAfter(
  events: StoredEvent[],
  afterId: string | null | undefined,
  now = Date.now(),
): EventRecord[] {
  const windowStart = now - EVENT_REPLAY_WINDOW_MS;
  const inWindow = events.filter((e) => e.occurredAtMs >= windowStart);
  if (!afterId) {
    return inWindow.slice(-EVENT_REPLAY_MAX).map((e) => e.record);
  }
  const idx = inWindow.findIndex((e) => e.record.event.id === afterId);
  if (idx < 0) {
    return [];
  }
  return inWindow.slice(idx + 1, idx + 1 + EVENT_REPLAY_MAX).map((e) => e.record);
}

export type EventMode = 'sse' | 'longpoll';

export interface EventSubscribeInput {
  method: string;
  origin: string;
  pageUrl?: string | null;
  after?: string | null;
  accept?: string | null;
  mode?: string | null;
  timeoutMs?: string | number | null;
  authenticated?: boolean;
  /** True when a session/cookie/bearer authenticator is valid. */
  sessionValid?: boolean;
  /** Resume header present. */
  resumeToken?: string | null;
  /** Whether that resume token is valid. */
  resumeValid?: boolean;
  /** Treat as SSE reconnect (MF-6b). Default: resume present + Accept event-stream. */
  sseReconnect?: boolean;
  eventsFeature?: boolean;
  /** When false, unknown page_url => 404. */
  pageExists?: boolean;
  /** Negotiated protocol version stamped on emitted envelopes. Default '1.1'. */
  appVersion?: AppProtocolVersion;
}

export type EventSubscribeDecision =
  | {
      ok: true;
      mode: EventMode;
      timeoutMs: number;
      heartbeatMs: number;
      pageUrl: string;
    }
  | { ok: false; envelope: ErrorEnvelope; httpStatus: number; stream: false };

function errorDecision(
  code: string,
  message?: string,
  app: AppProtocolVersion = '1.1',
): EventSubscribeDecision {
  const envelope = buildErrorEnvelope(code, { message, app });
  return { ok: false, envelope, httpStatus: resolveHttpStatus(envelope), stream: false };
}

export function decideEventSubscription(input: EventSubscribeInput): EventSubscribeDecision {
  const appVer = input.appVersion ?? '1.1';
  const method = input.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const envelope = buildErrorEnvelope('app.err.transport.method_not_allowed', {
      message: 'Events URL is GET only',
      app: appVer,
    });
    return { ok: false, envelope, httpStatus: 405, stream: false };
  }
  if (input.eventsFeature === false) {
    return errorDecision('app.err.events.unsupported', 'Events are not advertised', appVer);
  }

  const accept = (input.accept ?? '').toLowerCase();
  const wantsSse = accept.includes('text/event-stream');
  const wantsLongpoll = accept.includes(MEDIA_EVENT) || input.mode === 'longpoll';
  const mode: EventMode =
    input.mode === 'longpoll' || (!wantsSse && wantsLongpoll)
      ? 'longpoll'
      : wantsSse
        ? 'sse'
        : 'sse';
  if (input.mode && input.mode !== 'longpoll' && input.mode !== 'sse') {
    return errorDecision('app.err.events.mode', 'Unknown events mode', appVer);
  }

  const sseReconnect =
    input.sseReconnect ?? (Boolean(input.resumeToken) && (mode === 'sse' || wantsSse));
  if (input.resumeToken && input.resumeValid === false) {
    // MF-6b: invalid resume on SSE reconnect is auth.expired envelope, not a stream.
    if (sseReconnect || mode === 'sse' || mode === 'longpoll') {
      const envelope = buildErrorEnvelope('app.err.auth.expired', {
        message: 'Resume token is no longer valid',
        app: appVer,
      });
      return { ok: false, envelope, httpStatus: 401, stream: false };
    }
  }

  if (input.authenticated === false || (input.sessionValid === false && !input.resumeToken)) {
    const envelope = buildErrorEnvelope('app.err.auth.required', {
      message: 'Authentication required for events',
      app: appVer,
    });
    return { ok: false, envelope, httpStatus: 401, stream: false };
  }

  const pageUrl = input.pageUrl ?? '';
  if (!pageUrl) {
    return errorDecision('app.err.page.not_found', 'page_url is required', appVer);
  }
  if (input.pageExists === false) {
    return errorDecision('app.err.page.not_found', 'Unknown page_url', appVer);
  }
  if (!sameOrigin(pageUrl, input.origin)) {
    const envelope = buildErrorEnvelope('app.err.security.cross_origin', {
      message: 'page_url must be same-origin',
      app: appVer,
    });
    return { ok: false, envelope, httpStatus: 403, stream: false };
  }

  let timeoutMs: number;
  try {
    timeoutMs = parseLongpollTimeout(input.timeoutMs ?? undefined);
  } catch (e) {
    if (e instanceof AppError) {
      return { ok: false, envelope: e.envelope, httpStatus: e.httpStatus, stream: false };
    }
    throw e;
  }

  return {
    ok: true,
    mode,
    timeoutMs,
    heartbeatMs: HEARTBEAT_DEFAULT_MS,
    pageUrl,
  };
}

export async function collectReplay(
  store: EventStore,
  pageUrl: string,
  afterId?: string | null,
  now = Date.now(),
): Promise<EventRecord[]> {
  const exists = await store.pageExists(pageUrl);
  if (!exists) {
    throw new AppError('app.err.page.not_found', { message: 'Unknown page_url' });
  }
  const list = await store.list(pageUrl);
  return replayAfter(list, afterId, now);
}

export type LongpollResult =
  { status: 200; body: EventRecord; contentType: typeof MEDIA_EVENT } | { status: 204; body: null };

export function longpollResult(events: EventRecord[]): LongpollResult {
  const next = events.find((e) => e.event.type !== 'heartbeat') ?? events[0];
  if (!next) return { status: 204, body: null };
  return { status: 200, body: next, contentType: MEDIA_EVENT };
}
