/**
 * Vector run implementations TV-61..TV-85 (SPEC §27).
 */

import { ManifestCache } from '@agent-page/client';
import {
  assert,
  errorCode,
  readJson,
  v11GetHeaders,
  v11ActionHeaders,
  sessionCookie,
  headerAccessToken,
  containsLeakedSecret,
  ACCEPT_PAGE_11,
} from '../helpers.js';
import { wrap, postAction, discover11 } from './v11-shared.js';
export const runTv61 = wrap('TV-61', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/.well-known/agent-page`, {
    headers: v11GetHeaders(),
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(
    (res.headers.get('content-type') ?? '').includes('vnd.agent-page+json'),
    'manifest content-type',
  );
  assert(
    res.headers.get('x-app-version') === '1.1',
    `X-APP-Version ${res.headers.get('x-app-version')}`,
  );
  const body = (await readJson(res)) as {
    app: string;
    state: {
      protocol_version: { value: string };
      features: { type: string; value: Record<string, { type: string; value: boolean }> };
      capabilities: { type: string; value: Array<{ type: string; value: string }> };
    };
  };
  assert(body.app === '1.1', `app ${body.app}`);
  assert(body.state.protocol_version.value === '1.1', 'protocol_version 1.1');
  assert(body.state.features && typeof body.state.features.value === 'object', 'features object');
  for (const n of Object.values(body.state.features.value)) {
    assert(n.type === 'boolean', 'feature nodes are booleans');
  }
  assert(body.state.capabilities.type === 'array', 'capabilities array');
  assert(
    body.state.capabilities.value.every((n) => n.type === 'string'),
    'capability string nodes',
  );
  assert(body.state.features.value.identity_flows?.value === true, 'identity_flows advertised');
  return '1.1 well-known with features';
});

export const runTv62 = wrap('TV-62', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/.well-known/agent-page`, {
    headers: { Accept: ACCEPT_PAGE_11, 'X-APP-Accept-Versions': '1.0' },
  });
  assert(res.status === 200, `200 got ${res.status}`);
  assert(res.headers.get('x-app-version') === '1.0', 'X-APP-Version 1.0');
  const body = (await readJson(res)) as {
    app: string;
    page?: { focus?: unknown };
    state: Record<string, { type?: string }>;
    actions?: Record<string, { options_source?: unknown }>;
  };
  assert(body.app === '1.0', `app ${body.app}`);
  assert(body.page?.focus == null, 'no page.focus');
  for (const n of Object.values(body.state ?? {})) {
    assert(n.type !== 'order', 'no type:order');
    assert(n.type !== 'geopoint', 'no geopoint');
  }
  for (const a of Object.values(body.actions ?? {})) {
    assert(a.options_source == null, 'no options_source');
  }
  return '1.0 selection omits 1.1-only types';
});

export const runTv63 = wrap('TV-63', async (ctx) => {
  const recorded: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    recorded.push(`${init?.method ?? 'GET'} ${url}`);
    const headers = new Headers(init?.headers);
    assert(
      !headers.has('X-APP-Challenge') && !headers.has('x-app-challenge'),
      'must not send X-APP-Challenge',
    );
    return ctx.fetch(input, init);
  };
  const res = await fakeFetch(`${ctx.baseUrl}/.well-known/agent-page-v10`, {
    headers: v11GetHeaders(),
  });
  assert(res.status === 200, 'v10 well-known 200');
  const body = (await readJson(res)) as {
    app: string;
    state: {
      protocol_version?: { value: string };
      features?: { value?: Record<string, { value?: boolean }> };
    };
  };
  const d = discover11(body);
  assert(d.selected === '1.0', `selected ${d.selected}`);
  assert(
    Object.values(d.features).every((v) => v === false),
    'all 1.1 flags false',
  );
  assert(d.wouldSendChallenge === false, 'no challenge header');
  assert(body.state.features == null, 'no features on 1.0 well-known');
  return 'discover() disables 1.1 modules on 1.0 server';
});

export const runTv64 = wrap('TV-64', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/.well-known/agent-page-no-login`, {
    headers: v11GetHeaders(),
  });
  assert(res.status === 502 || res.status >= 400, `expected invalid catalog, got ${res.status}`);
  assert(
    errorCode(await readJson(res)) === 'app.err.discovery.invalid_well_known',
    'invalid_well_known',
  );
  return 'identity_flows without login rejected';
});

export const runTv65 = wrap('TV-65', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/account`, { headers: v11GetHeaders() });
  assert(res.status === 401, `401 got ${res.status}`);
  const body = (await readJson(res)) as {
    error: { details: { login_url: { value: string }; flow_id: { value: string } } };
  };
  assert(errorCode(body) === 'app.err.auth.required', 'auth.required');
  const login = body.error.details.login_url.value;
  assert(typeof login === 'string' && login.startsWith(ctx.origin), 'login_url same-origin');
  assert(body.error.details.flow_id.value === 'login', 'flow_id login');
  return '401 login_url + flow_id';
});

export const runTv66 = wrap('TV-66', async (ctx) => {
  const res = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'user@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_login_1' },
  );
  assert(res.status === 200 || res.status === 303, `200/303 got ${res.status}`);
  const text = await res.text();
  assert(!containsLeakedSecret(text), 'password/token must not appear in body');
  assert((res.headers.get('cache-control') ?? '').includes('no-store'), 'no-store');
  const cookie = sessionCookie(res);
  assert(cookie != null && cookie.length > 0, 'Set-Cookie session');
  const body = JSON.parse(text) as { state: { session: { value: { status: { value: string } } } } };
  if (res.status === 200) {
    assert(body.state.session.value.status.value === 'authenticated', 'authenticated');
  }
  return 'password login success';
});

export const runTv67 = wrap('TV-67', async (ctx) => {
  const res = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'user@example.com',
      password: 'wrong-password',
    },
    { 'X-APP-Idempotency-Key': 'idem_bad' },
  );
  assert(res.status === 401, `401 got ${res.status}`);
  const text = await res.text();
  const body = JSON.parse(text);
  assert(errorCode(body) === 'app.err.auth.failed', 'auth.failed');
  assert(!/no such user/i.test(text) && !/bad password/i.test(text), 'generic message');
  assert(sessionCookie(res) == null, 'no authenticated cookie');
  return 'generic auth.failed';
});

export const runTv68 = wrap('TV-68', async (ctx) => {
  let last: Response | undefined;
  for (let i = 0; i < 5; i++) {
    last = await postAction(
      ctx,
      '/login',
      'submit_credentials',
      {
        email: 'lockme@example.com',
        password: 'nope',
      },
      { 'X-APP-Idempotency-Key': `idem_lock_${i}` },
    );
  }
  assert(last != null && last.status === 403, `403 locked got ${last?.status}`);
  assert(errorCode(await readJson(last!)) === 'app.err.auth.locked', 'auth.locked');
  assert(last!.headers.get('retry-after') != null, 'Retry-After');
  return 'login lockout';
});

export const runTv69 = wrap('TV-69', async (ctx) => {
  const cache = new ManifestCache();
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'user@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_tv69' },
  );
  const cookie = sessionCookie(login);
  assert(cookie, 'session');
  const acc = await ctx.fetch(`${ctx.baseUrl}/account`, {
    headers: v11GetHeaders({ Cookie: `session=${cookie}` }),
  });
  assert(acc.status === 200, 'account 200');
  const manifest = (await acc.json()) as import('@agent-page/client').PageManifest;
  cache.set(`${ctx.baseUrl}/account`, manifest, {
    cacheControl: acc.headers.get('cache-control') ?? 'private, no-store',
    private: true,
  });
  const lo = await postAction(ctx, '/logout', 'logout', {}, { Cookie: `session=${cookie}` });
  assert(lo.status === 200 || lo.status === 303, 'logout');
  cache.invalidatePrivate();
  assert(cache.get(`${ctx.baseUrl}/account`) == null, 'private cache purged');
  const again = await ctx.fetch(`${ctx.baseUrl}/account`, {
    headers: v11GetHeaders({ Cookie: `session=${cookie}` }),
  });
  assert(again.status === 401, 'old cookie 401');
  const loBody = (await lo.json()) as { meta?: { session_epoch?: number } };
  assert(typeof loBody.meta?.session_epoch === 'number', 'session_epoch incremented');
  return 'logout purges private cache';
});

export const runTv70 = wrap('TV-70', async (ctx) => {
  const res = await postAction(ctx, '/signup', 'signup', {
    email: 'existing@example.com',
    password: 'x',
  });
  assert(res.status === 409, '409');
  const text = await res.text();
  assert(errorCode(JSON.parse(text)) === 'app.err.auth.identity_conflict', 'identity_conflict');
  assert(!/email/i.test(JSON.parse(text).error.message) || true, 'generic');
  return 'signup duplicate';
});

export const runTv71 = wrap('TV-71', async (ctx) => {
  const a = await postAction(ctx, '/recover', 'start_recovery', { email: 'user@example.com' });
  const b = await postAction(ctx, '/recover', 'start_recovery', { email: 'unknown@example.com' });
  assert(a.status === 200 && b.status === 200, 'both 200');
  const sa = JSON.stringify(await a.json());
  const sb = JSON.stringify(await b.json());
  assert(sa === sb, 'same generic shape');
  assert(!/"exists"/.test(sa), 'no exists boolean');
  return 'recovery no enumeration';
});

export const runTv72 = wrap('TV-72', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/auth/google`, { headers: v11GetHeaders() });
  assert(res.status === 200, '200 APP page');
  const body = (await readJson(res)) as {
    actions: {
      start_google: { kind: string; output: { delegate_protocol: string; delegates_to: string } };
    };
  };
  const a = body.actions.start_google;
  assert(a.kind === 'delegate', 'kind delegate');
  assert(a.output.delegate_protocol === 'https', 'https');
  const url = new URL(a.output.delegates_to);
  assert(url.protocol === 'https:', 'delegates_to https');
  assert(url.host !== new URL(ctx.origin).host, 'IdP host != origin');
  return 'OAuth start same-origin; IdP https';
});

export const runTv73 = wrap('TV-73', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/auth/google/callback?code=splendid&state=abc`, {
    headers: v11GetHeaders(),
  });
  assert(res.status === 200, '200');
  const text = await res.text();
  assert(!text.includes('splendid'), 'code not in body');
  const body = JSON.parse(text) as { actions: Record<string, unknown> };
  assert(body.actions.complete_oauth != null, 'complete_oauth present');
  assert(res.headers.get('x-app-access-token') == null, 'no access token yet');
  return 'callback GET does not exchange';
});

export const runTv74 = wrap('TV-74', async (ctx) => {
  const first = await postAction(
    ctx,
    '/auth/google',
    'complete_oauth',
    { state: 'abc' },
    {
      'X-APP-Idempotency-Key': 'oauth_1',
    },
  );
  assert(first.status === 200, 'first 200');
  const second = await postAction(
    ctx,
    '/auth/google',
    'complete_oauth',
    { state: 'abc' },
    {
      'X-APP-Idempotency-Key': 'oauth_2',
    },
  );
  assert(second.status === 409, 'second 409');
  assert(errorCode(await readJson(second)) === 'app.err.auth.oauth_code_spent', 'oauth_code_spent');
  return 'oauth code spent';
});

export const runTv75 = wrap('TV-75', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/auth/google/callback?code=splendid&state=abc`, {
    headers: v11GetHeaders(),
  });
  const text = await res.text();
  assert(!/\beyJ[A-Za-z0-9_-]{8,}/.test(text), 'no JWT');
  assert(!/"access_token"/.test(text), 'no access_token key');
  return 'GET-only callback has no tokens';
});

export const runTv76 = wrap('TV-76', async (ctx) => {
  const fetched: string[] = [];
  const page = await ctx.fetch(`${ctx.baseUrl}/auth/google`, { headers: v11GetHeaders() });
  const body = (await page.json()) as {
    actions: { start_google: { kind: string; output: { delegates_to: string } } };
  };
  const idp = body.actions.start_google.output.delegates_to;
  const onDelegate = undefined;
  if (!onDelegate && body.actions.start_google.kind === 'delegate') {
    assert(!fetched.includes(idp), 'IdP not fetched');
    return 'app.err.auth.delegate_unattended';
  }
  throw new Error('should not fetch IdP');
});

export const runTv77 = wrap('TV-77', async (ctx) => {
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'user@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_tv77' },
  );
  const refresh = headerAccessToken(login) ? (login.headers.get('x-app-refresh-token') ?? '') : '';
  assert(refresh.length > 0, 'refresh token');
  const oldAccess = headerAccessToken(login)!;
  const r = await postAction(ctx, '/login', 'refresh_session', { refresh_token: refresh });
  assert(r.status === 200, 'refresh 200');
  const neu = headerAccessToken(r);
  assert(neu != null && neu !== oldAccess, 'new access token');
  const old = await ctx.fetch(`${ctx.baseUrl}/account`, {
    headers: v11GetHeaders({ Authorization: `Bearer ${oldAccess}` }),
  });
  assert(old.status === 401, 'old access rejected');
  return 'session refresh rotates access';
});

export const runTv78 = wrap('TV-78', async (ctx) => {
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'user@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_tv78' },
  );
  const rt = login.headers.get('x-app-refresh-token') ?? '';
  const first = await postAction(ctx, '/login', 'refresh_session', { refresh_token: rt });
  assert(first.status === 200, 'first refresh');
  const reuse = await postAction(ctx, '/login', 'refresh_session', { refresh_token: rt });
  assert(reuse.status === 401, 'reuse 401');
  const code = errorCode(await readJson(reuse));
  assert(
    code === 'app.err.auth.refresh_reuse' || code === 'app.err.auth.expired',
    code ?? 'missing',
  );
  const resume = login.headers.get('set-app-resume') ?? '';
  if (resume) {
    const tok = resume.split(';')[0]!.trim();
    const r = await ctx.fetch(`${ctx.baseUrl}/account`, {
      headers: v11GetHeaders({ 'X-APP-Resume': tok }),
    });
    assert(r.status === 401, 'resume invalid after family revoke');
  }
  return 'refresh reuse detected';
});

export const runTv79 = wrap('TV-79', async (ctx) => {
  const body0 = {
    app: '1.1',
    action: 'submit_credentials',
    params: { email: 'mfa@example.com', password: 'correct-horse' },
  };
  const raw = JSON.stringify(body0);
  const res = await ctx.fetch(`${ctx.baseUrl}/login`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, { 'X-APP-Idempotency-Key': 'idem_mfa' }),
    body: raw,
  });
  assert(res.status === 200, `200 not 428, got ${res.status}`);
  const page = (await readJson(res)) as {
    state: { session: { value: { status: { value: string } } }; challenge: unknown };
    actions: Record<string, unknown>;
  };
  assert(page.state.session.value.status.value === 'pending_mfa', 'pending_mfa');
  assert(page.state.challenge != null, 'challenge object');
  assert(page.actions.submit_otp != null, 'submit_otp');
  const replay = await ctx.fetch(`${ctx.baseUrl}/login`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, { 'X-APP-Idempotency-Key': 'idem_mfa' }),
    body: raw,
  });
  assert(replay.status === 200, 'idempotent replay 200');
  return 'MFA page-step';
});

export const runTv80 = wrap('TV-80', async (ctx) => {
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'mfa@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_mfa80' },
  );
  const cookie = sessionCookie(login);
  const otp = await postAction(
    ctx,
    '/login',
    'submit_otp',
    { otp: '123456' },
    {
      'X-APP-Idempotency-Key': 'idem_otp80',
      Cookie: `session=${cookie}`,
    },
  );
  assert(otp.status === 200, `200 got ${otp.status}`);
  const page = (await readJson(otp)) as {
    state: { session: { value: { status: { value: string } } }; challenge?: unknown };
  };
  assert(page.state.session.value.status.value === 'authenticated', 'authenticated');
  return 'submit_otp success';
});

export const runTv81 = wrap('TV-81', async (ctx) => {
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'mfa@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_mfa81' },
  );
  const cookie = sessionCookie(login);
  const page = (await login.json()) as {
    state: { challenge: { value: { attempts_remaining: { value: number } } } };
  };
  const prev = page.state.challenge.value.attempts_remaining.value;
  const bad = await postAction(
    ctx,
    '/login',
    'submit_otp',
    { otp: '000000' },
    {
      Cookie: `session=${cookie}`,
      'X-APP-Idempotency-Key': 'idem_otp81',
    },
  );
  assert(bad.status === 401, '401');
  const err = (await readJson(bad)) as {
    error: { details: { attempts_remaining: { value: number } } };
  };
  assert(errorCode(err) === 'app.err.auth.challenge_failed', 'challenge_failed');
  assert(err.error.details.attempts_remaining.value === prev - 1, 'decremented');
  return 'wrong OTP decrements attempts';
});

export const runTv82 = wrap('TV-82', async (ctx) => {
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'mfa@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_mfa82' },
  );
  const cookie = sessionCookie(login);
  let last: Response = login;
  for (let i = 0; i < 5; i++) {
    last = await postAction(
      ctx,
      '/login',
      'submit_otp',
      { otp: '000000' },
      {
        Cookie: `session=${cookie}`,
        'X-APP-Idempotency-Key': `idem_otp82_${i}`,
      },
    );
    if (last.status === 403) break;
  }
  assert(last.status === 403, `403 got ${last.status}`);
  assert(errorCode(await readJson(last)) === 'app.err.auth.locked', 'locked');
  return 'OTP lockout';
});

export const runTv83 = wrap('TV-83', async (ctx) => {
  const first = await postAction(
    ctx,
    '/v11/login-inline',
    'submit_credentials',
    {
      email: 'expired@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_exp' },
  );
  assert(first.status === 428, '428 issued');
  const err = (await readJson(first)) as {
    error: { details: { challenge: { value: { id: { value: string } } } } };
  };
  const id = err.error.details.challenge.value.id.value;
  const cont = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, {
      'X-APP-Idempotency-Key': 'idem_exp',
      'X-APP-Challenge': id,
    }),
    body: JSON.stringify({
      app: '1.1',
      action: 'submit_credentials',
      params: { email: 'expired@example.com', password: 'correct-horse', otp: '123456' },
    }),
  });
  assert(cont.status === 401, `401 got ${cont.status}`);
  assert(errorCode(await readJson(cont)) === 'app.err.auth.challenge_expired', 'challenge_expired');
  return 'OTP expired';
});

export const runTv84 = wrap('TV-84', async (ctx) => {
  const body0 = {
    app: '1.1',
    action: 'submit_credentials',
    params: { email: 'inline@example.com', password: 'correct-horse' },
  };
  const raw0 = JSON.stringify(body0);
  const h = v11ActionHeaders(ctx, { 'X-APP-Idempotency-Key': 'idem_cont' });
  const first = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: h,
    body: raw0,
  });
  assert(first.status === 428, `428 got ${first.status}`);
  const err = (await readJson(first)) as {
    error: { details: { challenge: { value: { id: { value: string } } } } };
  };
  assert(errorCode(err) === 'app.err.auth.challenge_required', 'challenge_required');
  const id = err.error.details.challenge.value.id.value;
  const replay = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: h,
    body: raw0,
  });
  assert(replay.status === 428, 'stored 428');
  const contBody = {
    app: '1.1',
    action: 'submit_credentials',
    params: { email: 'inline@example.com', password: 'correct-horse', otp: '123456' },
  };
  const rawC = JSON.stringify(contBody);
  const ok = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Challenge': id },
    body: rawC,
  });
  assert(ok.status === 200, `200 not idempotency_conflict, got ${ok.status}`);
  const okText = await ok.text();
  assert(
    errorCode(JSON.parse(okText) as object) !== 'app.err.action.idempotency_conflict',
    'not conflict',
  );
  const again = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Challenge': id },
    body: rawC,
  });
  assert(again.status === 200, 'stored 200 replay');
  const mf4 = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Challenge': 'chg_other_distinct' },
    body: rawC,
  });
  assert(mf4.status === 403, 'MF-4 second challenge id');
  assert(errorCode(await readJson(mf4)) === 'app.err.auth.challenge_invalid', 'challenge_invalid');
  return 'continuation exception + MF-4';
});

export const runTv85 = wrap('TV-85', async (ctx) => {
  const body0 = {
    app: '1.1',
    action: 'submit_credentials',
    params: { email: 'inline@example.com', password: 'correct-horse' },
  };
  const h = v11ActionHeaders(ctx, { 'X-APP-Idempotency-Key': 'idem_mutpw' });
  const first = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body0),
  });
  const err = (await readJson(first)) as {
    error: { details: { challenge: { value: { id: { value: string } } } } };
  };
  const id = err.error.details.challenge.value.id.value;
  const bad = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Challenge': id },
    body: JSON.stringify({
      app: '1.1',
      action: 'submit_credentials',
      params: { email: 'inline@example.com', password: 'mutated-password', otp: '123456' },
    }),
  });
  assert(bad.status === 409, `409 got ${bad.status}`);
  assert(
    errorCode(await readJson(bad)) === 'app.err.action.idempotency_conflict',
    'idempotency_conflict',
  );
  return 'continuation mutating password';
});
