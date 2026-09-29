/**
 * SPEC-AUTH §7 client duty cycle vectors — client_credentials + refresh
 * against a mocked well-known/token endpoint. No network.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createClientCredentialsAuth } from '../src/auth.js';

const ORIGIN = 'https://app.example';
const TOKEN_URL = `${ORIGIN}/app-oauth/token`;

interface Req {
  url: string;
  method: string;
  body: string;
}

function mockTokenServer(opts: {
  tokenResponses?: Array<{ status: number; body: object }>;
  wellKnown?: object;
  failWellKnown?: boolean;
}) {
  const reqs: Req[] = [];
  let i = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';
    reqs.push({ url, method, body });
    if (url.endsWith('/.well-known/agent-page')) {
      if (opts.failWellKnown) return new Response('nope', { status: 404 });
      return Response.json(
        opts.wellKnown ?? {
          app: '1.1',
          state: {
            endpoints: { token_endpoint: TOKEN_URL },
            scopes_supported: ['read', 'class:safe'],
          },
          features: { auth_oauth: true },
        },
      );
    }
    const r = opts.tokenResponses?.[Math.min(i, (opts.tokenResponses?.length ?? 1) - 1)];
    i++;
    return Response.json(r?.body ?? {}, { status: r?.status ?? 200 });
  };
  return { fetchImpl: fetchImpl as typeof fetch, reqs };
}

const okToken = (over: object = {}) => ({
  status: 200,
  body: {
    access_token: 'AT-1',
    token_type: 'Bearer',
    expires_in: 300,
    refresh_token: 'RT-1',
    scope: 'read class:safe',
    ...over,
  },
});

test('discovery fetches well-known once and caches endpoints', async () => {
  const m = mockTokenServer({ tokenResponses: [okToken()] });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'agent-cli',
    clientSecret: 's3cret',
  });
  assert.equal(await auth.onAuthRefresh(), true);
  assert.equal(await auth.onAuthRefresh(), true);
  const wk = m.reqs.filter((r) => r.url.endsWith('/.well-known/agent-page'));
  assert.equal(wk.length, 1);
});

test('client_credentials grant body is form-urlencoded with credentials', async () => {
  const m = mockTokenServer({ tokenResponses: [okToken()] });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'agent-cli',
    clientSecret: 's3cret',
    scope: 'read',
  });
  await auth.onAuthRefresh();
  const t = m.reqs.find((r) => r.url === TOKEN_URL);
  assert.ok(t);
  assert.equal(t.method, 'POST');
  assert.ok(t.body.includes('grant_type=client_credentials'));
  assert.ok(t.body.includes('client_id=agent-cli'));
  assert.ok(t.body.includes('client_secret=s3cret'));
  assert.ok(t.body.includes('scope=read'));
});

test('getAuthHeaders returns Bearer after refresh; empty before', async () => {
  const m = mockTokenServer({ tokenResponses: [okToken()] });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'a',
    clientSecret: 's',
  });
  assert.deepEqual(await auth.getAuthHeaders(), {});
  await auth.onAuthRefresh();
  assert.deepEqual(await auth.getAuthHeaders(), { Authorization: 'Bearer AT-1' });
});

test('refresh uses refresh_token grant when available', async () => {
  const m = mockTokenServer({
    tokenResponses: [okToken(), okToken({ access_token: 'AT-2', refresh_token: 'RT-2' })],
  });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'a',
    clientSecret: 's',
  });
  await auth.onAuthRefresh();
  await auth.onAuthRefresh();
  const second = m.reqs.filter((r) => r.url === TOKEN_URL)[1];
  assert.ok(second.body.includes('grant_type=refresh_token'));
  assert.ok(second.body.includes('refresh_token=RT-1'));
  assert.deepEqual(await auth.getAuthHeaders(), { Authorization: 'Bearer AT-2' });
});

test('invalid_grant on refresh falls back to client_credentials', async () => {
  const m = mockTokenServer({
    tokenResponses: [
      okToken(),
      { status: 400, body: { error: 'invalid_grant' } },
      okToken({ access_token: 'AT-3' }),
    ],
  });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'a',
    clientSecret: 's',
  });
  await auth.onAuthRefresh();
  assert.equal(await auth.onAuthRefresh(), true);
  const third = m.reqs.filter((r) => r.url === TOKEN_URL)[2];
  assert.ok(third.body.includes('grant_type=client_credentials'));
  assert.deepEqual(await auth.getAuthHeaders(), { Authorization: 'Bearer AT-3' });
});

test('invalid_client → onAuthRefresh false (never retry)', async () => {
  const m = mockTokenServer({
    tokenResponses: [{ status: 401, body: { error: 'invalid_client' } }],
  });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'bad',
    clientSecret: 'wrong',
  });
  assert.equal(await auth.onAuthRefresh(), false);
  assert.deepEqual(await auth.getAuthHeaders(), {});
});

test('missing token_endpoint → onAuthRefresh false', async () => {
  const m = mockTokenServer({ wellKnown: { app: '1.1', state: {} } });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'a',
    clientSecret: 's',
  });
  assert.equal(await auth.onAuthRefresh(), false);
});

test('well-known failure → onAuthRefresh false', async () => {
  const m = mockTokenServer({ failWellKnown: true });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'a',
    clientSecret: 's',
  });
  assert.equal(await auth.onAuthRefresh(), false);
});

test('concurrent onAuthRefresh shares one refresh', async () => {
  const m = mockTokenServer({ tokenResponses: [okToken()] });
  const auth = createClientCredentialsAuth({
    fetch: m.fetchImpl,
    origin: ORIGIN,
    clientId: 'a',
    clientSecret: 's',
  });
  const [a, b] = await Promise.all([auth.onAuthRefresh(), auth.onAuthRefresh()]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.equal(m.reqs.filter((r) => r.url === TOKEN_URL).length, 1);
});
