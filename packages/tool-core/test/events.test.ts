import { describe, expect, it } from 'vitest';
import {
  emptyFeatures,
  lastEventIdHeader,
  longPollUrl,
  parseEventRecord,
  parseSSE,
  selectWatchTransport,
  sseAllowed,
} from '../src/index.js';

describe('events D-7', () => {
  it('parses Event Record', () => {
    const rec = parseEventRecord({
      app: '1.1',
      event: {
        id: 'evt_1',
        type: 'state.changed',
        page_id: 'p',
        page_url: 'https://example.com/p',
        version: 'v2',
        occurred_at: '2026-08-19T12:00:00.000Z',
        hint: 'revalidate',
      },
    });
    expect(rec?.event.id).toBe('evt_1');
    expect(parseEventRecord({ nope: true })).toBeNull();
  });

  it('SSE Last-Event-ID', () => {
    const parsed = parseSSE(
      [
        'id: evt_9',
        'event: message',
        'data: {"app":"1.1","event":{"id":"evt_9","type":"state.changed","page_id":"p","page_url":"https://example.com/p","version":"v2","occurred_at":"2026-08-19T12:00:00.000Z","hint":"diff"}}',
        '',
        '',
      ].join('\n'),
    );
    expect(parsed[0]?.id).toBe('evt_9');
    expect(parsed[0]?.record?.event.type).toBe('state.changed');
    expect(lastEventIdHeader('evt_9')).toEqual({ 'Last-Event-ID': 'evt_9' });
    expect(lastEventIdHeader(null)).toEqual({});
  });

  it('long-poll after query', () => {
    const url = longPollUrl('https://example.com/events', 'https://example.com/p', 'evt_9');
    expect(url).toContain('after=evt_9');
    expect(url).toContain('page_url=');
  });

  it('unknown type ignored', () => {
    const parsed = parseSSE(
      'id: evt_x\ndata: {"app":"1.1","event":{"id":"evt_x","type":"vendor.explode","page_id":"p","page_url":"https://example.com/p","version":"v1","occurred_at":"2026-08-19T12:00:00.000Z","hint":"drop"}}\n\n',
    );
    expect(parsed[0]?.ignored).toBe(true);
    expect(parsed[0]?.record?.event.type).toBe('vendor.explode');
  });

  it('no SSE if flags false', () => {
    const features = emptyFeatures();
    expect(sseAllowed(features)).toBe(false);
    expect(selectWatchTransport(features, { sse: true })).toBe('poll');
    expect(selectWatchTransport({ ...features, events_sse: true }, { sse: true })).toBe('sse');
    expect(selectWatchTransport({ ...features, events_longpoll: true }, { sse: true })).toBe(
      'longpoll',
    );
  });
});
