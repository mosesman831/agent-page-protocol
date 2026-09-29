/**
 * Challenge continuation vs idempotency_conflict (SPEC §18.2 / MF-4).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  v11ActionHeaders,
  errorCode,
} from '../src/index.js';

describe('challenge continuation', () => {
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

  it('same key + otp continuation is not idempotency_conflict', async () => {
    const h = v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'ch_ok' });
    const body0 = JSON.stringify({
      app: '1.1',
      action: 'submit_credentials',
      params: { email: 'inline@example.com', password: 'correct-horse' },
    });
    const first = await fetch(`${server.baseUrl}/v11/login-inline`, {
      method: 'POST',
      headers: h,
      body: body0,
    });
    expect(first.status).toBe(428);
    const id = (
      (await first.json()) as {
        error: { details: { challenge: { value: { id: { value: string } } } } };
      }
    ).error.details.challenge.value.id.value;
    const cont = JSON.stringify({
      app: '1.1',
      action: 'submit_credentials',
      params: { email: 'inline@example.com', password: 'correct-horse', otp: '123456' },
    });
    const ok = await fetch(`${server.baseUrl}/v11/login-inline`, {
      method: 'POST',
      headers: { ...h, 'X-APP-Challenge': id },
      body: cont,
    });
    expect(ok.status).toBe(200);
    expect(errorCode(await ok.json())).not.toBe('app.err.action.idempotency_conflict');
  });

  it('continuation mutating password is idempotency_conflict', async () => {
    const h = v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'ch_bad' });
    const first = await fetch(`${server.baseUrl}/v11/login-inline`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        app: '1.1',
        action: 'submit_credentials',
        params: { email: 'inline@example.com', password: 'correct-horse' },
      }),
    });
    const id = (
      (await first.json()) as {
        error: { details: { challenge: { value: { id: { value: string } } } } };
      }
    ).error.details.challenge.value.id.value;
    const bad = await fetch(`${server.baseUrl}/v11/login-inline`, {
      method: 'POST',
      headers: { ...h, 'X-APP-Challenge': id },
      body: JSON.stringify({
        app: '1.1',
        action: 'submit_credentials',
        params: { email: 'inline@example.com', password: 'other', otp: '123456' },
      }),
    });
    expect(bad.status).toBe(409);
    expect(errorCode(await bad.json())).toBe('app.err.action.idempotency_conflict');
  });

  it('MF-4: second distinct challenge id after terminal is challenge_invalid', async () => {
    const h = v11ActionHeaders(server, { 'X-APP-Idempotency-Key': 'ch_mf4' });
    const first = await fetch(`${server.baseUrl}/v11/login-inline`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        app: '1.1',
        action: 'submit_credentials',
        params: { email: 'inline@example.com', password: 'correct-horse' },
      }),
    });
    const id = (
      (await first.json()) as {
        error: { details: { challenge: { value: { id: { value: string } } } } };
      }
    ).error.details.challenge.value.id.value;
    const cont = JSON.stringify({
      app: '1.1',
      action: 'submit_credentials',
      params: { email: 'inline@example.com', password: 'correct-horse', otp: '123456' },
    });
    const ok = await fetch(`${server.baseUrl}/v11/login-inline`, {
      method: 'POST',
      headers: { ...h, 'X-APP-Challenge': id },
      body: cont,
    });
    expect(ok.status).toBe(200);
    await ok.text();
    const second = await fetch(`${server.baseUrl}/v11/login-inline`, {
      method: 'POST',
      headers: { ...h, 'X-APP-Challenge': 'chg_other' },
      body: cont,
    });
    expect(second.status).toBe(403);
    expect(errorCode(await second.json())).toBe('app.err.auth.challenge_invalid');
  });
});
