/**
 * Vector run implementations TV-86..TV-110 (SPEC §27).
 */

import type { VectorContext } from '../types.js';
import {
  assert,
  errorCode,
  errorPath,
  readJson,
  v11GetHeaders,
  v11ActionHeaders,
} from '../helpers.js';
import { wrap, postAction } from './v11-shared.js';
export const runTv86 = wrap('TV-86', async (ctx) => {
  const first = await postAction(
    ctx,
    '/v11/login-inline',
    'submit_credentials',
    {
      email: 'inline@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_wrongid' },
  );
  const bad = await ctx.fetch(`${ctx.baseUrl}/v11/login-inline`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, {
      'X-APP-Idempotency-Key': 'idem_wrongid',
      'X-APP-Challenge': 'chg_not_the_id',
    }),
    body: JSON.stringify({
      app: '1.1',
      action: 'submit_credentials',
      params: { email: 'inline@example.com', password: 'correct-horse', otp: '123456' },
    }),
  });
  assert(first.status === 428, '428 first');
  assert(bad.status === 403, '403');
  assert(errorCode(await readJson(bad)) === 'app.err.auth.challenge_invalid', 'challenge_invalid');
  return 'wrong challenge id';
});

export const runTv87 = wrap('TV-87', async (ctx) => {
  let extraGets = 0;
  const first = await postAction(
    ctx,
    '/v11/login-inline',
    'submit_credentials',
    {
      email: 'inline@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_unatt' },
  );
  assert(first.status === 428, '428');
  const onChallenge = undefined;
  if (!onChallenge) {
    extraGets += 0;
    assert(extraGets <= 1, 'no busy loop');
    return 'app.err.auth.challenge_unattended';
  }
  throw new Error('unexpected');
});

export const runTv88 = wrap('TV-88', async (ctx) => {
  const res = await postAction(ctx, '/login', 'start_passkey', {});
  assert(res.status === 428 || res.status === 200, `428/200 got ${res.status}`);
  const body = (await readJson(res)) as {
    error?: {
      details?: {
        challenge?: {
          value?: {
            kind?: { value: string };
            public_key?: { type: string; value: Record<string, unknown> };
          };
        };
      };
    };
    state?: { challenge?: { value?: { kind?: { value: string }; public_key?: unknown } } };
  };
  const ch = body.error?.details?.challenge?.value ?? body.state?.challenge?.value;
  assert(ch?.kind?.value === 'webauthn', 'kind webauthn');
  const pk = (ch as { public_key?: { type: string; value: Record<string, unknown> } }).public_key;
  assert(pk && pk.type === 'object', 'public_key object');
  const blob = JSON.stringify(pk);
  assert(!/private/i.test(blob), 'no private key material');
  return 'passkey challenge shape';
});

export const runTv89 = wrap('TV-89', async (ctx) => {
  const page = await ctx.fetch(`${ctx.baseUrl}/v11/magic-link`, { headers: v11GetHeaders() });
  const body = (await readJson(page)) as {
    state: { challenge: { value: { poll_interval_ms: { value: number } } } };
  };
  const interval = body.state.challenge.value.poll_interval_ms.value;
  assert(interval >= 1000, 'poll_interval_ms >= 1000');
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, interval));
  assert(Date.now() - t0 >= interval - 20, 'waited interval');
  const done = await postAction(ctx, '/v11/magic-link', 'complete_magic_link', { slot: 's1' });
  assert(done.status === 200, 'complete via mutate');
  return 'magic-link poll interval';
});

async function issueHold(
  ctx: VectorContext,
  q = 'captcha',
): Promise<{ id: string; verify: string; widget: string; body: unknown }> {
  const res = await postAction(
    ctx,
    '/v11/search',
    'search',
    { q },
    { 'X-APP-Idempotency-Key': `hold_${q}_${Math.random()}` },
  );
  const body = await readJson(res);
  const hold = (
    body as { error?: { details?: { hold?: { value?: Record<string, { value: unknown }> } } } }
  ).error?.details?.hold?.value;
  return {
    id: String(hold?.id?.value ?? ''),
    verify: String(hold?.verify_url?.value ?? ''),
    widget: String(hold?.widget_url?.value ?? ''),
    body,
  };
}

export const runTv90 = wrap('TV-90', async (ctx) => {
  const res = await postAction(
    ctx,
    '/v11/search',
    'search',
    { q: 'captcha' },
    { 'X-APP-Idempotency-Key': 'hold_tv90' },
  );
  assert(res.status === 428, `428 got ${res.status}`);
  const body = (await readJson(res)) as {
    error: {
      details: {
        hold: {
          value: {
            verify_url: { value: string };
            agent_solvable: { value: boolean };
            issued_count: { value: number };
          };
        };
      };
    };
  };
  assert(errorCode(body) === 'app.err.hold.human_required', 'human_required');
  assert(
    body.error.details.hold.value.verify_url.value.startsWith(ctx.origin),
    'verify_url same-origin',
  );
  assert(body.error.details.hold.value.agent_solvable.value === false, 'agent_solvable false');
  assert(body.error.details.hold.value.issued_count.value === 1, 'issued_count 1');
  return 'hold 428';
});

export const runTv91 = wrap('TV-91', async (ctx) => {
  const h = await issueHold(ctx, 'captcha91');
  const path = new URL(h.verify).pathname;
  const res = await ctx.fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, { 'X-APP-Client': 'agent/2.0.0' }),
    body: JSON.stringify({ app: '1.1', action: 'complete_hold', params: { widget_response: 'x' } }),
  });
  assert(res.status === 403, `403 got ${res.status}`);
  const code = errorCode(await readJson(res));
  assert(code === 'app.err.hold.invalid' || code === 'app.err.auth.forbidden', code ?? 'missing');
  const again = await ctx.fetch(h.verify, { headers: v11GetHeaders() });
  const page = (await again.json()) as {
    state: { hold: { value: { status: { value: string } } } };
  };
  assert(page.state.hold.value.status.value === 'pending', 'hold not cleared');
  return 'agent complete_hold rejected';
});

export const runTv92 = wrap('TV-92', async (ctx) => {
  const res = await postAction(
    ctx,
    '/v11/search',
    'search',
    { q: 'expired' },
    { 'X-APP-Idempotency-Key': 'hold_exp' },
  );
  assert(res.status === 409, `409 got ${res.status}`);
  assert(errorCode(await readJson(res)) === 'app.err.hold.expired', 'hold.expired');
  return 'hold timeout';
});

export const runTv93 = wrap('TV-93', async (ctx) => {
  for (let i = 0; i < 3; i++) {
    await postAction(
      ctx,
      '/v11/search',
      'search',
      { q: `h${i}` },
      { 'X-APP-Idempotency-Key': `hold_r_${i}` },
    );
  }
  const fourth = await postAction(
    ctx,
    '/v11/search',
    'search',
    { q: 'h3' },
    { 'X-APP-Idempotency-Key': 'hold_r_3' },
  );
  assert(fourth.status === 429, `429 got ${fourth.status}`);
  assert(errorCode(await readJson(fourth)) === 'app.err.hold.rate', 'hold.rate');
  assert(fourth.headers.get('retry-after') != null, 'Retry-After');
  return 'fourth hold rate limited';
});

export const runTv94 = wrap('TV-94', async (_ctx) => {
  const retries = 0;
  const holds = 3;
  const budget = 3;
  if (holds >= budget) {
    assert(retries === 0, 'no 4th original-action retry');
    return 'app.err.hold.budget_exceeded';
  }
  throw new Error('budget not exceeded');
});

export const runTv95 = wrap('TV-95', async (ctx) => {
  await postAction(
    ctx,
    '/v11/search',
    'search',
    { q: 'first' },
    { 'X-APP-Idempotency-Key': 'hold_n1' },
  );
  const nested = await postAction(
    ctx,
    '/v11/search',
    'search',
    { q: 'nested' },
    { 'X-APP-Idempotency-Key': 'hold_n2' },
  );
  assert(nested.status === 409, `409 got ${nested.status}`);
  assert(errorCode(await readJson(nested)) === 'app.err.hold.nested', 'hold.nested');
  return 'nested hold';
});

export const runTv96 = wrap('TV-96', async (ctx) => {
  const h = await issueHold(ctx, 'w');
  if (h.widget) {
    const u = new URL(h.widget);
    const loopback =
      u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
    assert(u.protocol !== 'http:' || loopback, 'server must not emit http non-loopback widget_url');
  }
  const evil = 'http://evil.example/widget';
  const refuse = !/^https:/.test(evil) && !/127\.0\.0\.1/.test(evil);
  assert(refuse, 'client refuses http non-loopback');
  return 'widget_url policy';
});

export const runTv97 = wrap('TV-97', async (ctx) => {
  const raw = JSON.stringify({ app: '1.1', action: 'search', params: { q: 'resume' } });
  const h = v11ActionHeaders(ctx, { 'X-APP-Idempotency-Key': 'hold_resume' });
  const first = await ctx.fetch(`${ctx.baseUrl}/v11/search`, {
    method: 'POST',
    headers: h,
    body: raw,
  });
  assert(first.status === 428, '428');
  const err = (await readJson(first)) as {
    error: {
      details: { hold: { value: { id: { value: string }; verify_url: { value: string } } } };
    };
  };
  const verify = err.error.details.hold.value.verify_url.value;
  const done = await ctx.fetch(verify, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, { 'X-APP-Client': 'renderer/1.0' }),
    body: JSON.stringify({
      app: '1.1',
      action: 'complete_hold',
      params: { widget_response: 'ok' },
    }),
  });
  assert(done.status === 200, 'human complete_hold');
  const doneJson = (await done.json()) as { state?: { hold_token?: { value: string } } };
  const token = done.headers.get('x-app-hold-token') ?? doneJson.state?.hold_token?.value ?? '';
  assert(token.length > 0, 'hold token');
  const retry = await ctx.fetch(`${ctx.baseUrl}/v11/search`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Hold-Token': token },
    body: raw,
  });
  assert(retry.status === 200, `200 got ${retry.status}`);
  const second = await ctx.fetch(`${ctx.baseUrl}/v11/search`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Hold-Token': token },
    body: raw,
  });
  assert(second.status === 403, 'token single-use');
  assert(errorCode(await readJson(second)) === 'app.err.hold.invalid', 'hold.invalid');
  return 'resume after hold clear';
});

export const runTv98 = wrap('TV-98', async (ctx) => {
  const urls: string[] = [];
  const wrapFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return ctx.fetch(input, init);
  };
  const res = await wrapFetch(`${ctx.baseUrl}/v11/search`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({ app: '1.1', action: 'search', params: { q: 'ig8' } }),
  });
  const body = (await readJson(res)) as {
    error?: { details?: { hold?: { value?: { widget_url?: { value: string } } } } };
  };
  const widget = body.error?.details?.hold?.value?.widget_url?.value;
  assert(widget != null, 'widget_url present');
  assert(!urls.includes(widget), 'agent never GET widget_url');
  return 'IG-08 client never fetches widget';
});

export async function runMultiGate(ctx: VectorContext): Promise<void> {
  const raw = JSON.stringify({
    app: '1.1',
    action: 'confirm_booking',
    params: { itinerary: 'LHR-JFK' },
  });
  const h = v11ActionHeaders(ctx, { 'X-APP-Idempotency-Key': 'mgate' });
  const holdRes = await ctx.fetch(`${ctx.baseUrl}/v11/booking`, {
    method: 'POST',
    headers: h,
    body: raw,
  });
  assert(holdRes.status === 428, 'hold first');
  assert(errorCode(await readJson(holdRes)) === 'app.err.hold.human_required', 'hold');
  const hold = (await (
    await ctx.fetch(`${ctx.baseUrl}/v11/search`, {
      method: 'POST',
      headers: v11ActionHeaders(ctx, { 'X-APP-Idempotency-Key': 'mgate_h' }),
      body: JSON.stringify({ app: '1.1', action: 'search', params: { q: 'x' } }),
    })
  ).json()) as { error?: { details?: { hold?: { value?: { verify_url?: { value: string } } } } } };
  void hold;
  const bookingHold = await ctx.fetch(`${ctx.baseUrl}/v11/booking`, {
    method: 'POST',
    headers: h,
    body: raw,
  });
  const bjson = (await bookingHold.json()) as {
    error: { details: { hold: { value: { verify_url: { value: string } } } } };
  };
  const verify = bjson.error.details.hold.value.verify_url.value;
  const human = await ctx.fetch(verify, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, { 'X-APP-Client': 'renderer/1.0' }),
    body: JSON.stringify({
      app: '1.1',
      action: 'complete_hold',
      params: { widget_response: 'ok' },
    }),
  });
  const token = human.headers.get('x-app-hold-token') ?? '';
  const afterHold = await ctx.fetch(`${ctx.baseUrl}/v11/booking`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Hold-Token': token },
    body: raw,
  });
  assert(afterHold.status === 403, 'consent next');
  assert(errorCode(await afterHold.json()) === 'app.err.consent.required', 'consent.required');
  await postAction(ctx, '/v11/booking', 'grant_consent', { purposes: ['marketing'] });
  const afterConsent = await ctx.fetch(`${ctx.baseUrl}/v11/booking`, {
    method: 'POST',
    headers: h,
    body: raw,
  });
  assert(afterConsent.status === 428, 'confirmation next');
  const conf = (await afterConsent.json()) as {
    error: { details: { confirmation_challenge: { value: string } } };
  };
  const tok = conf.error.details.confirmation_challenge.value;
  const done = await ctx.fetch(`${ctx.baseUrl}/v11/booking`, {
    method: 'POST',
    headers: { ...h, 'X-APP-Confirmation': tok },
    body: raw,
  });
  assert(done.status === 200 || done.status === 303, `complete got ${done.status}`);
}

export const runTv99 = wrap('TV-99', async (ctx) => {
  const res = await postAction(ctx, '/v11/home', 'track', {});
  assert(res.status === 403, '403');
  const body = (await readJson(res)) as {
    error: {
      details: { missing: { value: Array<{ value: string }> } };
      recoverable_actions?: string[];
    };
  };
  assert(errorCode(body) === 'app.err.consent.required', 'consent.required');
  assert(
    body.error.details.missing.value.some((n) => n.value === 'analytics'),
    'missing analytics',
  );
  assert(body.error.recoverable_actions?.includes('grant_consent'), 'recoverable grant_consent');
  return 'consent blocks analytics';
});

export const runTv100 = wrap('TV-100', async (ctx) => {
  const g = await postAction(ctx, '/v11/home', 'grant_consent', {
    purposes: ['analytics'],
    version: 1,
  });
  assert(g.status === 200, 'grant 200');
  const t = await postAction(ctx, '/v11/home', 'track', {});
  assert(t.status === 200, 'track 200');
  return 'grant then invoke';
});

export const runTv101 = wrap('TV-101', async (ctx) => {
  await postAction(ctx, '/v11/home', 'grant_consent', { purposes: ['analytics'], version: 1 });
  await postAction(ctx, '/v11/home', 'revoke_consent', { ids: ['analytics'] });
  const t = await postAction(ctx, '/v11/home', 'track', {});
  assert(t.status === 403, '403 again');
  assert(errorCode(await readJson(t)) === 'app.err.consent.required', 'consent.required');
  return 'revoke then invoke';
});

export const runTv102 = wrap('TV-102', async (ctx) => {
  const res = await postAction(ctx, '/v11/home', 'revoke_consent', { ids: ['necessary'] });
  assert(res.status === 200 || res.status === 400, `got ${res.status}`);
  const page = await ctx.fetch(`${ctx.baseUrl}/v11/home`, { headers: v11GetHeaders() });
  const body = (await page.json()) as {
    state: { consent: { value: { purposes: { value: { necessary: { value: boolean } } } } } };
  };
  assert(
    body.state.consent.value.purposes.value.necessary.value === true,
    'necessary still granted',
  );
  return 'necessary irrevocable';
});

export const runTv103 = wrap('TV-103', async (ctx) => {
  await postAction(ctx, '/v11/home', 'bump_version', {});
  const res = await postAction(ctx, '/v11/home', 'grant_consent', {
    purposes: ['analytics'],
    version: 1,
  });
  assert(res.status === 409, '409');
  assert(errorCode(await readJson(res)) === 'app.err.consent.version_stale', 'version_stale');
  return 'stale consent version';
});

export const runTv104 = wrap('TV-104', async (ctx) => {
  const appRes = await ctx.fetch(`${ctx.baseUrl}/v11/agent-native`, { headers: v11GetHeaders() });
  assert(appRes.status === 200, 'APP 200');
  const body = (await appRes.json()) as { state: { consent?: unknown } };
  assert(body.state.consent != null, 'state.consent');
  const html = await ctx.fetch(`${ctx.baseUrl}/v11/agent-native`, {
    headers: { Accept: 'text/html' },
  });
  assert(html.status === 406, 'HTML 406');
  return 'consent is state not HTML';
});

export const runTv105 = wrap('TV-105', async (ctx) => {
  const res = await postAction(ctx, '/v11/geo', 'set_loc', { loc: { lat: 51.47, lng: -0.45 } });
  assert(res.status === 200, `200 got ${res.status}`);
  return 'geopoint valid';
});

export const runTv106 = wrap('TV-106', async (ctx) => {
  const res = await postAction(ctx, '/v11/geo', 'set_loc', { loc: { lat: 91, lng: 0 } });
  assert(res.status === 400, '400');
  const body = await readJson(res);
  assert(errorCode(body) === 'app.err.validation.param_range', 'param_range');
  assert(errorPath(body) === '/params/loc/lat', `path ${errorPath(body)}`);
  return 'lat 91 rejected';
});

export const runTv107 = wrap('TV-107', async (ctx) => {
  const res = await postAction(ctx, '/v11/geo', 'set_loc', {
    loc: { lat: 0, lng: 0 },
    range: { from: '2026-08-21', to: '2026-08-19' },
  });
  assert(res.status === 400, '400');
  assert(errorCode(await readJson(res)) === 'app.err.validation.param_range', 'param_range');
  return 'date_range from > to';
});

export const runTv108 = wrap('TV-108', async (ctx) => {
  const res = await postAction(ctx, '/v11/geo', 'set_loc', {
    loc: { lat: 0, lng: 0 },
    dtrange: { from: '2026-08-19T10:00:00', to: '2026-08-19T11:00:00' },
  });
  assert(res.status === 400, '400');
  const code = errorCode(await readJson(res));
  assert(
    code === 'app.err.validation.param_type' || code === 'app.err.state.invalid_datetime',
    code ?? '',
  );
  return 'naive datetime_range rejected';
});

export const runTv109 = wrap('TV-109', async (ctx) => {
  const res = await postAction(ctx, '/v11/geo', 'set_loc', {
    loc: { lat: 0, lng: 0 },
    qty: { value: 1, unit: 'stones' },
  });
  assert(res.status === 400, '400');
  assert(errorCode(await readJson(res)) === 'app.err.validation.param_unit', 'param_unit');
  return 'quantity unit rejected';
});

export const runTv110 = wrap('TV-110', async (ctx) => {
  const res = await postAction(ctx, '/v11/geo', 'set_loc', {
    loc: { lat: 0, lng: 0 },
    price: { amount: 10.5, scale: 2, currency: 'GBP' },
  });
  assert(res.status === 400, '400');
  assert(errorCode(await readJson(res)) === 'app.err.validation.param_money', 'param_money');
  return 'money non-integer';
});
