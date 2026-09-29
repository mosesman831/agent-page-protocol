import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  MEDIA_ACTION,
  ACCEPT_DIFF,
  errorCode,
} from '../src/index.js';

describe('CSRF Origin precedence (§10.2 / §19.3 #14)', () => {
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

  it('mismatched Origin + valid X-APP-Origin + session cookie → 403', async () => {
    const res = await fetch(`${server.baseUrl}/vectors/csrf`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        Origin: 'https://attacker.example',
        'X-APP-Origin': server.origin,
        Cookie: 'session=valid-csrf-session',
      },
      body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
    });
    expect(res.status).toBe(403);
    expect(errorCode(await res.json())).toBe('app.err.security.csrf');
  });

  it('Origin absent + matching X-APP-Origin + Cookie only → 403 csrf', async () => {
    const res = await fetch(`${server.baseUrl}/vectors/csrf`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        'X-APP-Origin': server.origin,
        Cookie: 'session=valid-csrf-session',
      },
      body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
    });
    expect(res.status).toBe(403);
    expect(errorCode(await res.json())).toBe('app.err.security.csrf');
  });

  it('Origin absent + matching X-APP-Origin + Authorization Bearer → allowed', async () => {
    const res = await fetch(`${server.baseUrl}/vectors/csrf`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        'X-APP-Origin': server.origin,
        Authorization: 'Bearer csrf-test-token',
      },
      body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
    });
    expect(res.status).toBe(200);
  });

  it('matching Origin succeeds', async () => {
    const res = await fetch(`${server.baseUrl}/vectors/csrf`, {
      method: 'POST',
      headers: {
        Accept: ACCEPT_DIFF,
        'Content-Type': MEDIA_ACTION,
        Origin: server.origin,
      },
      body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
    });
    expect(res.status).toBe(200);
  });
});
