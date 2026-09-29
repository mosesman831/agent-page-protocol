import { describe, it, expect } from 'vitest';
import {
  parseEventRecordJson,
  parseSseEventRecords,
  parseSseFrame,
  splitSseFrames,
} from '../src/events.js';

const RECORD = {
  app: '1.1' as const,
  event: {
    id: 'evt_01J8Z',
    type: 'state.changed' as const,
    page_id: 'flight-results',
    page_url: 'https://example.com/flights/LHR/DXB/2026-08-15?pax=1',
    version: 'v12',
    occurred_at: '2026-08-19T10:00:00.000Z',
    hint: 'revalidate' as const,
  },
};

describe('SSE Event Record parser (§14.3)', () => {
  it('parses data: Event Record from a standard SSE frame', () => {
    const sse = [
      'retry: 3000',
      'id: evt_01J8Z',
      'event: state.changed',
      `data: ${JSON.stringify(RECORD)}`,
      '',
      ':',
      'id: evt_hb',
      'event: heartbeat',
      `data: ${JSON.stringify({
        ...RECORD,
        event: {
          ...RECORD.event,
          id: 'evt_hb',
          type: 'heartbeat',
          occurred_at: '2026-08-19T10:00:15.000Z',
        },
      })}`,
      '',
    ].join('\n');

    const records = parseSseEventRecords(sse);
    expect(records).toHaveLength(2);
    expect(records[0]!.event.id).toBe('evt_01J8Z');
    expect(records[0]!.event.type).toBe('state.changed');
    expect(records[0]!.event.hint).toBe('revalidate');
    expect(records[1]!.event.type).toBe('heartbeat');
  });

  it('concatenates multi-line data: fields per SSE spec', () => {
    const json = JSON.stringify(RECORD);
    const mid = Math.floor(json.length / 2);
    const frame = parseSseFrame(
      `id: evt_01J8Z\ndata: ${json.slice(0, mid)}\ndata: ${json.slice(mid)}`,
    );
    expect(frame).toBeTruthy();
    expect(frame!.data).toBe(json);
    const rec = parseEventRecordJson(frame!.data);
    expect(rec?.event.id).toBe('evt_01J8Z');
  });

  it('ignores comments and incomplete trailing chunks', () => {
    const { frames, rest } = splitSseFrames('id: a\ndata: {"app":"1.1"\n');
    expect(frames).toHaveLength(0);
    expect(rest).toContain('data:');
  });
});
