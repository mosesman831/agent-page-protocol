import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  MEDIA_ACTION,
  ACCEPT_DIFF,
  errorCode,
} from '../src/index.js';

describe('Confirmation replay (§19.3 #13 / §10.4)', () => {
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

  async function challenge(params: Record<string, unknown>, idem: string) {
    const res = await fetch(`${server.baseUrl}/vectors/confirmation-replay`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        Origin: server.origin,
        'X-APP-Idempotency-Key': idem,
        Cookie: 'session=conf-replay',
      },
      body: JSON.stringify({ app: '1.0', action: 'pay', params }),
    });
    expect(res.status).toBe(428);
    const body = (await res.json()) as {
      error: { details: { confirmation_challenge: { value: string } } };
    };
    return body.error.details.confirmation_challenge.value;
  }

  it('mutated params with echoed token → 403 confirmation_invalid', async () => {
    const token = await challenge({ amount: 10, currency: 'GBP' }, 'idem_conf_mut_1');

    const res = await fetch(`${server.baseUrl}/vectors/confirmation-replay`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        Origin: server.origin,
        'X-APP-Idempotency-Key': 'idem_conf_mut_2',
        'X-APP-Confirmation': token,
        Cookie: 'session=conf-replay',
      },
      body: JSON.stringify({
        app: '1.0',
        action: 'pay',
        params: { amount: 50, currency: 'EUR' },
      }),
    });
    expect(res.status).toBe(403);
    expect(errorCode(await res.json())).toBe('app.err.action.confirmation_invalid');
  });

  it('token is single-use (replay after success → 403)', async () => {
    const params = { amount: 10, currency: 'GBP' };
    const token = await challenge(params, 'idem_conf_once_1');

    const ok = await fetch(`${server.baseUrl}/vectors/confirmation-replay`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        Origin: server.origin,
        'X-APP-Idempotency-Key': 'idem_conf_once_1',
        'X-APP-Confirmation': token,
        'X-APP-If-Match-Version': 'v1',
        Cookie: 'session=conf-replay',
      },
      body: JSON.stringify({ app: '1.0', action: 'pay', params }),
    });
    expect(ok.status).toBe(200);

    const replay = await fetch(`${server.baseUrl}/vectors/confirmation-replay`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        Origin: server.origin,
        'X-APP-Idempotency-Key': 'idem_conf_once_2',
        'X-APP-Confirmation': token,
        Cookie: 'session=conf-replay',
      },
      body: JSON.stringify({ app: '1.0', action: 'pay', params }),
    });
    expect(replay.status).toBe(403);
    expect(errorCode(await replay.json())).toBe('app.err.action.confirmation_invalid');
  });
});
