/**
 * Events: heartbeat, long-poll 204, 401 envelope not stream (SPEC §34).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  v11GetHeaders,
  errorCode,
} from '../src/index.js';

describe('events (1.1)', () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    server = await startConformanceServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.state.reset(server.port);
  });

  it('SSE opens with a heartbeat event', async () => {
    const ac = new AbortController();
    const res = await fetch(`${server.baseUrl}/app-events`, {
      headers: { Accept: 'text/event-stream' },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const start = Date.now();
    while (Date.now() - start < 1500) {
      const { value } = await Promise.race([
        reader.read(),
        new Promise<{ value?: Uint8Array }>((r) => setTimeout(() => r({}), 200)),
      ]);
      if (value) buf += dec.decode(value, { stream: true });
      if (buf.includes('heartbeat')) break;
    }
    ac.abort();
    expect(buf).toMatch(/heartbeat/);
  });

  it('long-poll with no changes returns 204 empty within 2s', async () => {
    const t0 = Date.now();
    const res = await fetch(`${server.baseUrl}/app-events?mode=longpoll&timeout_ms=1000`, {
      headers: v11GetHeaders(),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('private page SSE without credentials is 401 envelope, not a stream', async () => {
    const res = await fetch(
      `${server.baseUrl}/app-events?page_url=${encodeURIComponent(server.baseUrl + '/account')}`,
      { headers: { Accept: 'text/event-stream' } },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/event-stream/);
    expect(errorCode(await res.json())).toBe('app.err.auth.required');
  });
});
