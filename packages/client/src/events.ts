/**
 * SSE Event Record parser + long-poll (SPEC-v0.5-extreme §14).
 * Agents use fetch + Authorization, never EventSource.
 */

import { AppError } from './errors.js';
import type { AppHttpClient } from './http.js';
import { MEDIA_EVENT, MEDIA_EVENT_STREAM } from './media-types.js';
import { isSameOrigin, resolveAppUrl } from './navigate.js';
import type { EventHint, EventRecord, EventRecordBody, EventType, PageManifest } from './types.js';

export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export interface SubscribeOptions {
  onEvent: (event: EventRecord) => void | Promise<void>;
  eventsUrl?: string;
  types?: string[];
  lastEventId?: string;
  mode?: 'sse' | 'longpoll' | 'auto';
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EventSubscription {
  close(): void;
  readonly closed: boolean;
}

const KNOWN_EVENT_TYPES = new Set<string>([
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse one SSE dispatch block (fields separated by newlines). */
export function parseSseFrame(block: string): SseFrame | null {
  const lines = block.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const dataLines: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  let retry: number | undefined;
  let sawField = false;
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
    }
    if (!field) continue;
    sawField = true;
    if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'retry') {
      const n = Number(value);
      if (Number.isFinite(n)) retry = n;
    }
  }
  if (!sawField) return null;
  // Compact Event Records are single-line JSON. If a server splits one JSON
  // object across data: fields, glue without inserting extra newlines so the
  // record stays parseable. Fall back to SSE newline join when glue is not JSON.
  const glued = dataLines.join('');
  const withLf = dataLines.join('\n');
  let data = glued;
  if (glued !== withLf) {
    try {
      JSON.parse(glued);
      data = glued;
    } catch {
      data = withLf;
    }
  }
  return { id, event, data, retry };
}

/** Split an SSE buffer into complete frames (trailing incomplete chunk returned). */
export function splitSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const part of parts) {
    const frame = parseSseFrame(part);
    if (frame) frames.push(frame);
  }
  return { frames, rest };
}

export function isEventRecord(value: unknown): value is EventRecord {
  if (!value || typeof value !== 'object') return false;
  const rec = value as EventRecord;
  if (rec.app !== '1.0' && rec.app !== '1.1') return false;
  const ev = rec.event as EventRecordBody | undefined;
  if (!ev || typeof ev !== 'object') return false;
  return (
    typeof ev.id === 'string' &&
    typeof ev.type === 'string' &&
    typeof ev.page_id === 'string' &&
    typeof ev.page_url === 'string' &&
    typeof ev.version === 'string' &&
    typeof ev.occurred_at === 'string' &&
    typeof ev.hint === 'string'
  );
}

export function parseEventRecordJson(data: string): EventRecord | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return isEventRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Parse an SSE document into Event Records (`data:` is an Event Record). */
export function parseSseEventRecords(text: string): EventRecord[] {
  const { frames, rest } = splitSseFrames(text.endsWith('\n\n') ? text : `${text}\n\n`);
  const extra = rest.trim() ? parseSseFrame(rest) : null;
  const all = extra ? [...frames, extra] : frames;
  const out: EventRecord[] = [];
  for (const frame of all) {
    const rec = parseEventRecordJson(frame.data);
    if (rec) out.push(rec);
  }
  return out;
}

export function isKnownEventType(type: string): type is EventType {
  return KNOWN_EVENT_TYPES.has(type);
}

export function eventsUrlFrom(manifest: PageManifest): string | undefined {
  const stateUrl = manifest.state?.events_url;
  if (stateUrl && stateUrl.type === 'string' && typeof stateUrl.value === 'string') {
    return stateUrl.value;
  }
  const metaUrl = manifest.meta?.events_url;
  if (typeof metaUrl === 'string') return metaUrl;
  return undefined;
}

function buildEventsQuery(
  eventsUrl: string,
  pageUrl: string,
  options: { types?: string[]; lastEventId?: string; mode?: 'longpoll'; timeoutMs?: number },
): string {
  const u = new URL(eventsUrl);
  u.searchParams.set('page_url', pageUrl);
  if (options.types?.length) u.searchParams.set('types', options.types.join(','));
  if (options.mode === 'longpoll') {
    u.searchParams.set('mode', 'longpoll');
    u.searchParams.set('timeout_ms', String(options.timeoutMs ?? 25_000));
    if (options.lastEventId) u.searchParams.set('after', options.lastEventId);
  }
  return u.href;
}

export async function longPollEvent(
  http: AppHttpClient,
  eventsUrl: string,
  pageUrl: string,
  options: { types?: string[]; lastEventId?: string; timeoutMs?: number } = {},
): Promise<EventRecord | null> {
  const url = buildEventsQuery(eventsUrl, pageUrl, {
    types: options.types,
    lastEventId: options.lastEventId,
    mode: 'longpoll',
    timeoutMs: options.timeoutMs,
  });
  const { meta, body } = await http.get(url, {
    pageUrl,
    extraHeaders: { Accept: MEDIA_EVENT },
  });
  if (meta.status === 204) return null;
  if (meta.status >= 400) {
    http.throwIfError(body, meta);
  }
  if (isEventRecord(body)) return body;
  return null;
}

export async function subscribeEvents(
  http: AppHttpClient,
  pageUrl: string,
  options: SubscribeOptions,
): Promise<EventSubscription> {
  const eventsUrl = options.eventsUrl;
  if (!eventsUrl) {
    throw new AppError('app.err.events.unsupported', {
      message: 'No events_url for subscribe',
    });
  }
  const absEvents = resolveAppUrl(eventsUrl, pageUrl);
  if (!isSameOrigin(absEvents, pageUrl)) {
    throw new AppError('app.err.security.cross_origin', {
      message: 'events_url must be same-origin',
    });
  }

  const ac = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) ac.abort();
    else options.signal.addEventListener('abort', () => ac.abort(), { once: true });
  }

  let closed = false;
  const close = () => {
    closed = true;
    ac.abort();
  };

  const mode = options.mode ?? 'auto';
  if (mode !== 'auto' && mode !== 'sse' && mode !== 'longpoll') {
    throw new AppError('app.err.events.mode', {
      message: `Bad events mode: ${String(mode)}`,
      httpStatus: 400,
    });
  }
  const useSse = mode === 'sse' || mode === 'auto';

  const run = async () => {
    if (useSse) {
      try {
        await readSse(http, absEvents, pageUrl, options, ac.signal, () => closed);
        return;
      } catch (e) {
        if (closed || ac.signal.aborted) return;
        if (mode === 'sse') throw e;
      }
    }
    await readLongPoll(http, absEvents, pageUrl, options, ac.signal, () => closed);
  };

  const running = run();
  void running.catch(() => undefined);

  return {
    close,
    get closed() {
      return closed;
    },
  };
}

async function readSse(
  http: AppHttpClient,
  eventsUrl: string,
  pageUrl: string,
  options: SubscribeOptions,
  signal: AbortSignal,
  isClosed: () => boolean,
): Promise<void> {
  const url = buildEventsQuery(eventsUrl, pageUrl, { types: options.types });
  const extra: Record<string, string> = {};
  if (options.lastEventId) extra['Last-Event-ID'] = options.lastEventId;
  const res = await http.getEventStream(url, { pageUrl, extraHeaders: extra, signal });
  if (res.status !== 200) {
    const body = await res.text();
    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = null;
    }
    http.throwIfError(parsed, http.parseMeta(res));
    throw new AppError('app.err.events.unsupported', { httpStatus: res.status });
  }
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!isClosed() && !signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const split = splitSseFrames(buffer);
    buffer = split.rest;
    for (const frame of split.frames) {
      const rec = parseEventRecordJson(frame.data);
      if (!rec) continue;
      if (!isKnownEventType(rec.event.type)) continue;
      await options.onEvent(rec);
    }
  }
}

async function readLongPoll(
  http: AppHttpClient,
  eventsUrl: string,
  pageUrl: string,
  options: SubscribeOptions,
  signal: AbortSignal,
  isClosed: () => boolean,
): Promise<void> {
  let after = options.lastEventId;
  while (!isClosed() && !signal.aborted) {
    const rec = await longPollEvent(http, eventsUrl, pageUrl, {
      types: options.types,
      lastEventId: after,
      timeoutMs: options.timeoutMs,
    });
    if (isClosed() || signal.aborted) return;
    if (!rec) {
      await sleep(Math.floor(Math.random() * 100));
      continue;
    }
    after = rec.event.id;
    if (!isKnownEventType(rec.event.type)) continue;
    await options.onEvent(rec);
  }
}

export { MEDIA_EVENT, MEDIA_EVENT_STREAM };
export type { EventHint };
