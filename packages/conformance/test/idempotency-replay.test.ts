import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  MEDIA_ACTION,
  ACCEPT_DIFF,
  errorCode,
  readTextAndJson,
} from '../src/index.js';

describe('Idempotency replay (§19.3 #12)', () => {
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

  it('same key + same body returns byte-equal response body', async () => {
    const key = 'idem_replay_aaaa';
    const body = JSON.stringify({
      app: '1.0',
      action: 'add',
      params: { amount: 3 },
    });
    const headers: Record<string, string> = {
      Accept: ACCEPT_DIFF,
      'Content-Type': MEDIA_ACTION,
      Origin: server.origin,
      'X-APP-Idempotency-Key': key,
      'X-APP-If-Match-Version': 'v1',
      Cookie: 'session=idem-replay',
    };

    const a = await fetch(`${server.baseUrl}/vectors/idempotency`, {
      method: 'POST',
      headers,
      body,
    });
    expect(a.status).toBe(200);
    const aPayload = await readTextAndJson(a);

    // Replay with stale If-Match-Version — must still succeed via idempotency lookup
    const b = await fetch(`${server.baseUrl}/vectors/idempotency`, {
      method: 'POST',
      headers,
      body,
    });
    expect(b.status).toBe(200);
    const bPayload = await readTextAndJson(b);
    expect(bPayload.text).toBe(aPayload.text);
  });

  it('same key + different body → 409 idempotency_conflict', async () => {
    const key = 'idem_conflict_bbbb';
    const headers: Record<string, string> = {
      Accept: ACCEPT_DIFF,
      'Content-Type': MEDIA_ACTION,
      Origin: server.origin,
      'X-APP-Idempotency-Key': key,
      Cookie: 'session=idem-conflict',
    };

    const first = await fetch(`${server.baseUrl}/vectors/idempotency`, {
      method: 'POST',
      headers: { ...headers, 'X-APP-If-Match-Version': 'v1' },
      body: JSON.stringify({
        app: '1.0',
        action: 'add',
        params: { amount: 1 },
      }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.baseUrl}/vectors/idempotency`, {
      method: 'POST',
      headers: { ...headers, 'X-APP-If-Match-Version': 'v2' },
      body: JSON.stringify({
        app: '1.0',
        action: 'add',
        params: { amount: 2 },
      }),
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(errorCode(body)).toBe('app.err.action.idempotency_conflict');
  });
});
