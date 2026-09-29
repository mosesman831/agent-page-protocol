/**
 * Hold budget, nested, agent complete_hold (SPEC §7 / §34).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  v11ActionHeaders,
  errorCode,
  runMultiGate,
} from '../src/index.js';

describe('hold (1.1)', () => {
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

  it('agent complete_hold is 403 and does not clear hold', async () => {
    const issued = await fetch(`${server.baseUrl}/v11/search`, {
      method: 'POST',
      headers: v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'h1' }),
      body: JSON.stringify({ app: '1.1', action: 'search', params: { q: 'c' } }),
    });
    const verify = (
      (await issued.json()) as {
        error: { details: { hold: { value: { verify_url: { value: string } } } } };
      }
    ).error.details.hold.value.verify_url.value;
    const agent = await fetch(verify, {
      method: 'POST',
      headers: v11ActionHeaders(server, { 'X-APP-Client': 'agent/2.0.0' }),
      body: JSON.stringify({
        app: '1.1',
        action: 'complete_hold',
        params: { widget_response: 'x' },
      }),
    });
    expect(agent.status).toBe(403);
    expect(errorCode(await agent.json())).toBe('app.err.hold.invalid');
  });

  it('nested hold is 409', async () => {
    await fetch(`${server.baseUrl}/v11/search`, {
      method: 'POST',
      headers: v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'n1' }),
      body: JSON.stringify({ app: '1.1', action: 'search', params: { q: 'a' } }),
    });
    const nested = await fetch(`${server.baseUrl}/v11/search`, {
      method: 'POST',
      headers: v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'n2' }),
      body: JSON.stringify({ app: '1.1', action: 'search', params: { q: 'nested' } }),
    });
    expect(nested.status).toBe(409);
    expect(errorCode(await nested.json())).toBe('app.err.hold.nested');
  });

  it('fourth hold in the window is 429 hold.rate', async () => {
    for (let i = 0; i < 3; i++) {
      await fetch(`${server.baseUrl}/v11/search`, {
        method: 'POST',
        headers: v11ActionHeaders(server, { 'X-APP-Idempotency-Key': `r${i}` }),
        body: JSON.stringify({ app: '1.1', action: 'search', params: { q: `h${i}` } }),
      });
    }
    const fourth = await fetch(`${server.baseUrl}/v11/search`, {
      method: 'POST',
      headers: v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'r3' }),
      body: JSON.stringify({ app: '1.1', action: 'search', params: { q: 'h3' } }),
    });
    expect(fourth.status).toBe(429);
    expect(errorCode(await fourth.json())).toBe('app.err.hold.rate');
  });

  it('multi-gate hold then consent then confirmation on one body', async () => {
    await runMultiGate({
      baseUrl: server.baseUrl,
      origin: server.origin,
      fetch: globalThis.fetch,
    });
  });
});
