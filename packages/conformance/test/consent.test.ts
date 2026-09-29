/**
 * Consent: necessary is irrevocable (SPEC §8 / §34).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  v11ActionHeaders,
  v11GetHeaders,
  errorCode,
} from '../src/index.js';

describe('consent (1.1)', () => {
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

  it('necessary cannot be revoked', async () => {
    const res = await fetch(`${server.baseUrl}/v11/home`, {
      method: 'POST',
      headers: v11ActionHeaders(server),
      body: JSON.stringify({
        app: '1.1',
        action: 'revoke_consent',
        params: { ids: ['necessary'] },
      }),
    });
    expect(res.status === 200 || res.status === 400).toBe(true);
    const page = await fetch(`${server.baseUrl}/v11/home`, { headers: v11GetHeaders() });
    const body = (await page.json()) as {
      state: { consent: { value: { purposes: { value: { necessary: { value: boolean } } } } } };
    };
    expect(body.state.consent.value.purposes.value.necessary.value).toBe(true);
  });

  it('analytics action is blocked until grant', async () => {
    const blocked = await fetch(`${server.baseUrl}/v11/home`, {
      method: 'POST',
      headers: v11ActionHeaders(server),
      body: JSON.stringify({ app: '1.1', action: 'track', params: {} }),
    });
    expect(blocked.status).toBe(403);
    expect(errorCode(await blocked.json())).toBe('app.err.consent.required');
    await fetch(`${server.baseUrl}/v11/home`, {
      method: 'POST',
      headers: v11ActionHeaders(server),
      body: JSON.stringify({
        app: '1.1',
        action: 'grant_consent',
        params: { purposes: ['analytics'], version: 1 },
      }),
    });
    const ok = await fetch(`${server.baseUrl}/v11/home`, {
      method: 'POST',
      headers: v11ActionHeaders(server),
      body: JSON.stringify({ app: '1.1', action: 'track', params: {} }),
    });
    expect(ok.status).toBe(200);
  });
});
