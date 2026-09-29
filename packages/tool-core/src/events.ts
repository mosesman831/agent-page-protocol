/**
 * SSE / long-poll / Event Record parse; Last-Event-ID (CLIENT-TOOL-CONTRACT D-7).
 */

import type { FeatureFlags } from './capabilities.js';
import { MEDIA_EVENT, MEDIA_EVENT_STREAM } from './types.js';

export interface EventRecord {
  app?: string;
  event: {
    id: string;
    type: string;
    page_id?: string;
    page_url: string;
    version?: string;
    occurred_at?: string;
    hint?: string;
    [k: string]: unknown;
  };
}
import { featureEnabled } from './capabilities.js';

const KNOWN_EVENT_TYPES = new Set([
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

export type WatchTransport = 'poll' | 'sse' | 'longpoll' | 'ws';

export function isKnownEventType(type: string): boolean {
  return KNOWN_EVENT_TYPES.has(type);
}

export function parseEventRecord(data: unknown): EventRecord | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as EventRecord;
  if (!rec.event || typeof rec.event !== 'object') return null;
  if (typeof rec.event.id !== 'string' || typeof rec.event.type !== 'string') return null;
  if (typeof rec.event.page_url !== 'string') return null;
  return rec;
}

export interface ParsedSseEvent {
  id?: string;
  event?: string;
  data?: string;
  record?: EventRecord | null;
  ignored?: boolean;
}

export function parseSSE(chunk: string): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = [];
  const blocks = chunk.replace(/\r\n/g, '\n').split('\n\n');
  for (const block of blocks) {
    if (!block.trim() || block.startsWith(':')) continue;
    const parsed: ParsedSseEvent = {};
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) parsed.id = line.slice(3).trim();
      else if (line.startsWith('event:')) parsed.event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) parsed.data = dataLines.join('\n');
    if (parsed.data) {
      try {
        const rec = parseEventRecord(JSON.parse(parsed.data) as unknown);
        parsed.record = rec;
        if (rec && !isKnownEventType(rec.event.type)) {
          parsed.ignored = true;
        }
      } catch {
        parsed.record = null;
      }
    }
    if (parsed.id || parsed.data) events.push(parsed);
  }
  return events;
}

export function lastEventIdHeader(id: string | null | undefined): Record<string, string> {
  if (!id) return {};
  return { 'Last-Event-ID': id };
}

export function longPollUrl(
  eventsUrl: string,
  pageUrl: string,
  after?: string | null,
  types?: string[],
): string {
  const u = new URL(eventsUrl, pageUrl);
  u.searchParams.set('page_url', pageUrl);
  if (after) u.searchParams.set('after', after);
  if (types?.length) u.searchParams.set('types', types.join(','));
  return u.toString();
}

export function sseUrl(eventsUrl: string, pageUrl: string, types?: string[]): string {
  const u = new URL(eventsUrl, pageUrl);
  u.searchParams.set('page_url', pageUrl);
  if (types?.length) u.searchParams.set('types', types.join(','));
  return u.toString();
}

export function selectWatchTransport(
  features: FeatureFlags | undefined | null,
  flags: { sse?: boolean; ws?: boolean } = {},
): WatchTransport {
  if (flags.ws && featureEnabled(features, 'events_ws')) return 'ws';
  if (flags.sse && featureEnabled(features, 'events_sse')) return 'sse';
  if (featureEnabled(features, 'events_longpoll') || featureEnabled(features, 'events_sse')) {
    return 'longpoll';
  }
  return 'poll';
}

export function sseAllowed(features: FeatureFlags | undefined | null): boolean {
  return featureEnabled(features, 'events_sse');
}

export const EVENT_ACCEPT_SSE = MEDIA_EVENT_STREAM;
export const EVENT_ACCEPT_LONGPOLL = MEDIA_EVENT;
