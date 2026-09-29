/**
 * Identity flows: token-not-in-body scanner; lockout (SPEC §34).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  v11ActionHeaders,
  v11GetHeaders,
  errorCode,
  containsLeakedSecret,
} from '../src/index.js';

describe('identity (1.1)', () => {
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

  it('login success body never contains password or access_token', async () => {
    const res = await fetch(`${server.baseUrl}/login`, {
      method: 'POST',
      headers: v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'id_scan' }),
      body: JSON.stringify({
        app: '1.1',
        action: 'submit_credentials',
        params: { email: 'user@example.com', password: 'correct-horse' },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(containsLeakedSecret(text)).toBe(false);
    expect(res.headers.get('x-app-access-token')).toBeTruthy();
  });

  it('OAuth callback scanner: no JWT prefix, no access_token keys', async () => {
    const res = await fetch(`${server.baseUrl}/auth/google/callback?code=splendid&state=abc`, {
      headers: v11GetHeaders(),
    });
    const text = await res.text();
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/);
    expect(text).not.toMatch(/"access_token"/);
    expect(text).not.toMatch(/splendid/);
  });

  it('lockout after 5 failed logins', async () => {
    let last!: Response;
    for (let i = 0; i < 5; i++) {
      last = await fetch(`${server.baseUrl}/login`, {
        method: 'POST',
        headers: v11ActionHeaders(server, { 'X-APP-Idempotency-Key': `lock_${i}` }),
        body: JSON.stringify({
          app: '1.1',
          action: 'submit_credentials',
          params: { email: 'lock@example.com', password: 'bad' },
        }),
      });
    }
    expect(last.status).toBe(403);
    expect(errorCode(await last.json())).toBe('app.err.auth.locked');
    expect(last.headers.get('retry-after')).toBeTruthy();
  });
});
