/**
 * Vector run implementations TV-153..TV-156 (SPEC §27): auth/hold/consent
 * transition enforcement — illegal transitions and catalog violations.
 */

import { assert, errorCode, readJson, v11GetHeaders } from '../helpers.js';
import { AgentClient } from '@agent-page/client';
import { wrap, postAction } from './v11-shared.js';

export const runTv153 = wrap('TV-153', async (ctx) => {
  const denied = await ctx.fetch(`${ctx.baseUrl}/auth/google/callback?error=access_denied`, {
    headers: v11GetHeaders(),
  });
  assert(denied.status === 400, `400, got ${denied.status}`);
  const dBody = await readJson(denied);
  assert(errorCode(dBody) === 'app.err.auth.oauth_denied', `oauth_denied, got ${errorCode(dBody)}`);

  const ok = await ctx.fetch(`${ctx.baseUrl}/auth/google/callback?code=splendid`, {
    headers: v11GetHeaders(),
  });
  assert(ok.status === 200, `200, got ${ok.status}`);
  const okBody = await readJson(ok);
  assert('page' in (okBody as object), 'callback page');
  return 'IdP error= -> oauth_denied 400; code -> callback page';
});

export const runTv154 = wrap('TV-154', async (ctx) => {
  // Logout with no session = illegal transition (§5.1): anonymous --logout is
  // not in the table -> 409 session_invalid.
  const anon = await postAction(ctx, '/logout', 'logout', {});
  assert(anon.status === 409, `409, got ${anon.status}`);
  const aBody = await readJson(anon);
  assert(
    errorCode(aBody) === 'app.err.auth.session_invalid',
    `session_invalid, got ${errorCode(aBody)}`,
  );

  const anonAll = await postAction(ctx, '/logout', 'logout_all', {});
  assert(anonAll.status === 409, `409, got ${anonAll.status}`);

  // Authenticated logout is still legal: login then logout.
  const login = await postAction(ctx, '/login', 'submit_credentials', {
    email: 'user@example.com',
    password: 'correct-horse',
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  assert(cookie.includes('session='), 'session cookie');
  const lo = await postAction(ctx, '/logout', 'logout', {}, { Cookie: cookie });
  assert(lo.status === 200, `200, got ${lo.status}`);

  // A second logout on the now-expired session is also an illegal transition.
  const again = await postAction(ctx, '/logout', 'logout', {}, { Cookie: cookie });
  assert(again.status === 409, `409, got ${again.status}`);
  return 'logout anonymous/expired -> session_invalid; authenticated -> 200';
});

export const runTv155 = wrap('TV-155', async (ctx) => {
  const bad = await postAction(ctx, '/v11/home', 'grant_consent', {
    purposes: ['telemetry'],
  });
  assert(bad.status === 400, `400, got ${bad.status}`);
  const bBody = await readJson(bad);
  assert(
    errorCode(bBody) === 'app.err.consent.unknown_purpose',
    `unknown_purpose, got ${errorCode(bBody)}`,
  );

  const ok = await postAction(ctx, '/v11/home', 'grant_consent', {
    purposes: ['marketing'],
    version: null,
  });
  assert(ok.status === 200, `200, got ${ok.status}`);
  return 'undeclared purpose -> unknown_purpose; declared purpose grants';
});

export const runTv156 = wrap('TV-156', async (ctx) => {
  const res = await postAction(ctx, '/v11/search', 'search', { q: 'badwidget' });
  assert(res.status === 500, `500, got ${res.status}`);
  const body = await readJson(res);
  assert(
    errorCode(body) === 'app.err.hold.invalid_widget',
    `invalid_widget, got ${errorCode(body)}`,
  );

  // A legal hold still emits widget_url as before.
  const good = await postAction(ctx, '/v11/search', 'search', { q: 'captcha' });
  assert(good.status === 428, `428, got ${good.status}`);
  const gBody = (await readJson(good)) as {
    error?: { details?: { hold?: { value?: { widget_url?: { value?: string } } } } };
  };
  const wu = gBody.error?.details?.hold?.value?.widget_url?.value ?? '';
  assert(wu.startsWith('https://'), `https widget_url, got ${wu}`);
  return 'illegal widget_url -> invalid_widget 500; legal hold unaffected';
});

export const runTv157 = wrap('TV-157', async (ctx) => {
  const bad = await ctx.fetch(`${ctx.baseUrl}/app-events?mode=bogus`, {
    headers: v11GetHeaders({ Accept: 'text/event-stream' }),
  });
  assert(bad.status === 400, `400, got ${bad.status}`);
  const bBody = await readJson(bad);
  assert(errorCode(bBody) === 'app.err.events.mode', `events.mode, got ${errorCode(bBody)}`);

  // mode=sse with a streaming Accept opens the channel.
  const ac = new AbortController();
  const ok = await ctx.fetch(`${ctx.baseUrl}/app-events?mode=sse`, {
    headers: v11GetHeaders({ Accept: 'text/event-stream' }),
    signal: ac.signal,
  });
  assert(ok.status === 200, `200, got ${ok.status}`);
  const ct = ok.headers.get('content-type') ?? '';
  assert(ct.includes('event-stream'), `event-stream content-type, got ${ct}`);
  ac.abort();
  return 'bad mode -> events.mode 400; mode=sse opens stream';
});

export const runTv158 = wrap('TV-158', async (ctx) => {
  const client = new AgentClient({
    fetch: ctx.fetch,
    onChallenge: async () => ({ otp: '123456' }),
    onConfirm: async () => true,
  });

  // Declared 3-factor chain (meta.flow.step_count = 3): all three steps pass.
  const p1 = await client.hydrate(`${ctx.baseUrl}/v11/login3fa`);
  const r1 = await client.invoke(p1, 'submit_credentials', {
    email: 'user@example.com',
    password: 'correct-horse',
  });
  assert(r1.manifest.page.id === 'login3fa_2', `step-2 page, got ${r1.manifest.page.id}`);
  const r2 = await client.invoke(r1.manifest, 'submit_factor', { totp: '123456' });
  assert(r2.manifest.page.id === 'login3fa_3', `step-3 page, got ${r2.manifest.page.id}`);
  const r3 = await client.invoke(r2.manifest, 'submit_final', { backup: '123456' });
  assert(r3.manifest.page.id === 'account', `account page, got ${r3.manifest.page.id}`);
  const sess = r3.manifest.state.session as { value?: { status?: { value?: string } } } | undefined;
  assert(sess?.value?.status?.value === 'authenticated', 'authenticated session');

  // Undeclared chain (step_count = 2): the third factor step aborts client-side.
  const t1 = await client.hydrate(`${ctx.baseUrl}/v11/login3fa-tight`);
  const t2 = await client.invoke(t1, 'submit_credentials', {
    email: 'user@example.com',
    password: 'correct-horse',
  });
  const t3 = await client.invoke(t2.manifest, 'submit_factor', { totp: '123456' });
  let code: string | null = null;
  try {
    await client.invoke(t3.manifest, 'submit_final', { backup: '123456' });
  } catch (e) {
    code = (e as { code?: string }).code ?? null;
  }
  assert(code === 'app.err.auth.challenge_nested', `challenge_nested, got ${code}`);
  return 'declared step_count=3 completes; undeclared third factor -> challenge_nested';
});
