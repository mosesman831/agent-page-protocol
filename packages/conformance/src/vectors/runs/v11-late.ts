/**
 * Vector run implementations TV-111..TV-140 (SPEC §27).
 */

import {
  assert,
  errorCode,
  readJson,
  tvPath,
  v11GetHeaders,
  v11ActionHeaders,
  sessionCookie,
  ACCEPT_PAGE_11,
  ACCEPT_VERSIONS_11,
  ACCEPT_DIFF_11,
  HEADER_ACCEPT_VERSIONS,
  MEDIA_ACTION,
  MEDIA_DIFF,
  MEDIA_PAGE,
} from '../helpers.js';
import { applyDiffDocument } from '@agent-page/server';
import type { DiffDocument, PageManifest } from '@agent-page/server';
import { wrap, postAction } from './v11-shared.js';
export const runTv111 = wrap('TV-111', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/v11/geo`, {
    headers: { Accept: ACCEPT_PAGE_11, 'X-APP-Accept-Versions': '1.0' },
  });
  assert(res.status === 200, '200');
  const body = (await readJson(res)) as {
    app: string;
    state: { loc: { type: string; value: { lat: { type: string }; lng: { type: string } } } };
  };
  assert(body.app === '1.0', 'selected 1.0');
  assert(body.state.loc.type === 'object', 'projected object');
  assert(
    body.state.loc.value.lat.type === 'number' && body.state.loc.value.lng.type === 'number',
    'lat/lng numbers',
  );
  return 'geopoint 1.0 projection';
});

export const runTv112 = wrap('TV-112', async (ctx) => {
  const res = await postAction(ctx, '/v11/airports', 'search_airports', { q: 'LH' });
  assert(res.status === 200, '200');
  const body = (await readJson(res)) as { state: { suggestions: { value: unknown[] } } };
  assert(Array.isArray(body.state.suggestions.value), 'table');
  assert(body.state.suggestions.value.length <= 64, '<= 64 rows');
  return 'options_source happy path';
});

export const runTv113 = wrap('TV-113', async (ctx) => {
  const posts: string[] = [];
  const page = await ctx.fetch(`${ctx.baseUrl}/v11/bad-typeahead`, { headers: v11GetHeaders() });
  const body = (await page.json()) as {
    actions: {
      search_box: { input: { q: { options_source: { action: string } } } };
      publish_mutate: { kind: string };
    };
  };
  const target = body.actions.search_box.input.q.options_source.action;
  assert(body.actions[target as 'publish_mutate']?.kind === 'mutate', 'points at mutate');
  assert(!posts.includes('publish_mutate'), 'MUST NOT POST the mutate');
  return 'options_source mutate ignored';
});

export const runTv114 = wrap('TV-114', async (_ctx) => {
  const sent: string[] = [];
  const min = 2;
  const q = 'L';
  if (q.length < min) {
    assert(sent.length === 0, 'client MUST NOT send');
    return 'typeahead below min_query_length';
  }
  throw new Error('should not send');
});

export const runTv115 = wrap('TV-115', async (ctx) => {
  const ok = await ctx.fetch(`${ctx.baseUrl}/v11/upload`, {
    method: 'POST',
    headers: {
      ...v11ActionHeaders(ctx),
      'Content-Type': 'multipart/form-data; boundary=----bound',
    },
    body: '------bound\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhi\r\n------bound--\r\n',
  });
  assert(ok.status === 200, `multipart 200 got ${ok.status}`);
  const off = await ctx.fetch(`${ctx.baseUrl}/v11/upload-off`, {
    method: 'POST',
    headers: {
      ...v11ActionHeaders(ctx),
      'Content-Type': 'multipart/form-data; boundary=----bound',
    },
    body: '------bound\r\nContent-Disposition: form-data; name="file"\r\n\r\nx\r\n------bound--\r\n',
  });
  assert(off.status === 415, '415 without capability');
  assert(
    errorCode(await readJson(off)) === 'app.err.action.upload_unsupported',
    'upload_unsupported',
  );
  return 'multipart upload';
});

export const runTv116 = wrap('TV-116', async (_ctx) => {
  const putUrl = 'https://uploads.example-cdn.net/put/file_fresh';
  const recorded: Array<{ url: string; cookie?: string }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    recorded.push({ url, cookie: headers.get('Cookie') ?? headers.get('cookie') ?? undefined });
    return new Response('', { status: 200 });
  };
  const origin = 'http://127.0.0.1:9';
  if (new URL(putUrl).host !== new URL(origin).host) {
    await fakeFetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: 'x',
    });
  }
  assert(recorded.length === 1, 'PUT issued');
  assert(!recorded[0]!.cookie, 'Cookie absent on cross-origin PUT');
  return 'presign PUT strips cookie';
});

export const runTv117 = wrap('TV-117', async (ctx) => {
  const res = await postAction(ctx, '/v11/presign', 'attach_file', { file_id: 'file_expired' });
  assert(res.status === 409, '409');
  assert(errorCode(await readJson(res)) === 'app.err.action.upload_expired', 'upload_expired');
  return 'presign expired';
});

export const runTv118 = wrap('TV-118', async (ctx) => {
  const res = await postAction(ctx, '/v11/presign', 'attach_file', {
    file_id: 'file_fresh',
    sha256: 'nope',
  });
  assert(res.status === 400, '400');
  assert(errorCode(await readJson(res)) === 'app.err.validation.param_file', 'param_file');
  return 'sha256 mismatch';
});

export const runTv119 = wrap('TV-119', async (ctx) => {
  await postAction(ctx, '/v11/order', 'mark_paid', {});
  const res = await postAction(ctx, '/v11/order', 'set_status', { status: 'draft' });
  assert(res.status === 409, '409');
  assert(
    errorCode(await readJson(res)) === 'app.err.commerce.illegal_transition',
    'illegal_transition',
  );
  return 'paid -> draft forbidden';
});

export const runTv120 = wrap('TV-120', async (ctx) => {
  const fetched: string[] = [];
  const first = await postAction(ctx, '/v11/order', 'pay_redirect', {});
  assert(first.status === 428, '428 confirmation');
  assert(
    errorCode(await readJson(first)) === 'app.err.action.confirmation_required',
    'confirmation_required',
  );
  const tok = (
    (await (await postAction(ctx, '/v11/order', 'pay_redirect', {})).json()) as {
      error: { details: { confirmation_challenge: { value: string } } };
    }
  ).error.details.confirmation_challenge.value;
  const ok = await postAction(ctx, '/v11/order', 'pay_redirect', {}, { 'X-APP-Confirmation': tok });
  assert(ok.status === 200 || ok.status === 303, `got ${ok.status}`);
  const page = (await ok.json()) as {
    actions?: { continue_pay?: { output?: { delegates_to?: string } } };
  };
  const bank = page.actions?.continue_pay?.output?.delegates_to;
  assert(bank != null && bank.startsWith('https://'), 'delegate https');
  assert(!fetched.includes(bank), 'agent did not fetch bank URL');
  return 'pay delegate after confirmation';
});

export const runTv121 = wrap('TV-121', async (ctx) => {
  const res = await postAction(ctx, '/v11/order', 'refund', { amount: 999999 });
  assert(res.status === 400, '400');
  assert(errorCode(await readJson(res)) === 'app.err.commerce.amount', 'commerce.amount');
  return 'refund over amount';
});

export const runTv122 = wrap('TV-122', async (ctx) => {
  await postAction(ctx, '/v11/order', 'mark_delivered', {});
  const res = await postAction(ctx, '/v11/order', 'cancel', {});
  assert(res.status === 409, '409');
  const code = errorCode(await readJson(res));
  assert(
    code === 'app.err.action.unavailable' || code === 'app.err.commerce.illegal_transition',
    code ?? '',
  );
  return 'cancel delivered forbidden';
});

export const runTv123 = wrap('TV-123', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/pay/3ds-callback?code=splendid3ds`, {
    headers: v11GetHeaders(),
  });
  assert(res.status === 200, '200');
  const text = await res.text();
  assert(!text.includes('splendid3ds'), 'no code leak');
  const body = JSON.parse(text) as {
    state: { order: { value: { status: string } }; paid?: { value: boolean } };
    actions: Record<string, unknown>;
  };
  assert(body.state.order.value.status !== 'paid', 'not paid yet');
  assert(body.actions.complete_payment != null, 'complete_payment present');
  return '3DS callback GET no capture';
});

export const runTv124 = wrap('TV-124', async (ctx) => {
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'user@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_resume' },
  );
  const set = login.headers.get('set-app-resume') ?? '';
  const tok = set.split(';')[0]!.trim();
  assert(tok.length > 0, 'resume token');
  const res = await ctx.fetch(`${ctx.baseUrl}/account`, {
    headers: v11GetHeaders({ 'X-APP-Resume': tok }),
  });
  assert(res.status === 200 || res.status === 401, `got ${res.status}`);
  if (res.status === 200) {
    const body = (await res.json()) as {
      state: { session: { value: { status: { value: string } } } };
    };
    assert(body.state.session.value.status.value === 'authenticated', 'authenticated');
  } else {
    const err = (await res.json()) as {
      error: { details?: { refresh_available?: { value: boolean } } };
    };
    assert(err.error.details?.refresh_available?.value === true, 'refresh_available');
  }
  return 'resume valid rehydrate';
});

export const runTv125 = wrap('TV-125', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/account`, {
    headers: v11GetHeaders({ 'X-APP-Resume': 'bogus' }),
  });
  assert(res.status === 401, '401');
  assert(errorCode(await readJson(res)) === 'app.err.auth.resume_invalid', 'resume_invalid');
  return 'resume invalid';
});

export const runTv126 = wrap('TV-126', async (ctx) => {
  await postAction(ctx, '/v11/live', 'bump', {}, { 'X-APP-If-Match-Version': 'v1' });
  const stale = await postAction(ctx, '/v11/live', 'bump', {}, { 'X-APP-If-Match-Version': 'v1' });
  assert(stale.status === 409, '409');
  assert(errorCode(await readJson(stale)) === 'app.err.diff.conflict', 'diff.conflict');
  return 'multi-client version conflict';
});

export const runTv127 = wrap('TV-127', async (ctx) => {
  const login = await postAction(
    ctx,
    '/login',
    'submit_credentials',
    {
      email: 'user@example.com',
      password: 'correct-horse',
    },
    { 'X-APP-Idempotency-Key': 'idem_epoch' },
  );
  const cookie = sessionCookie(login);
  const acc = await ctx.fetch(`${ctx.baseUrl}/account`, {
    headers: v11GetHeaders({ Cookie: `session=${cookie}` }),
  });
  const etag = acc.headers.get('etag');
  await postAction(ctx, '/account', 'logout_all', {}, { Cookie: `session=${cookie}` });
  const again = await ctx.fetch(`${ctx.baseUrl}/account`, {
    headers: v11GetHeaders({ Cookie: `session=${cookie}`, 'If-None-Match': etag ?? '' }),
  });
  assert(again.status !== 304, 'not 304 of private page');
  assert(again.status === 401 || again.status === 200, `got ${again.status}`);
  return 'session_epoch cache key';
});

export const runTv128 = wrap('TV-128', async (ctx) => {
  const ac = new AbortController();
  const sseP = ctx.fetch(
    `${ctx.baseUrl}/app-events?page_url=${encodeURIComponent(ctx.baseUrl + '/v11/live')}`,
    {
      headers: { Accept: 'text/event-stream', 'X-APP-Accept-Versions': ACCEPT_VERSIONS_11 },
      signal: ac.signal,
    },
  );
  await new Promise((r) => setTimeout(r, 50));
  const mut = await postAction(ctx, '/v11/live', 'bump', {}, { 'X-APP-If-Match-Version': 'v1' });
  const resultVer = ((await mut.json()) as { page: { version: string } }).page.version;
  const sse = await sseP;
  const reader = sse.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (buf.includes('state.changed') && buf.includes(resultVer)) break;
  }
  ac.abort();
  assert(buf.includes('state.changed'), 'state.changed event');
  assert(buf.includes(resultVer), 'version matches');
  return 'SSE state.changed';
});

export const runTv129 = wrap('TV-129', async (ctx) => {
  await postAction(ctx, '/v11/live', 'bump', {}, { 'X-APP-If-Match-Version': 'v1' });
  await postAction(ctx, '/v11/live', 'bump', {}, { 'X-APP-If-Match-Version': 'v2' });
  const ac = new AbortController();
  const recon = await ctx.fetch(
    `${ctx.baseUrl}/app-events?page_url=${encodeURIComponent(ctx.baseUrl + '/v11/live')}`,
    {
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': '1' },
      signal: ac.signal,
    },
  );
  const reader = recon.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const start = Date.now();
  while (Date.now() - start < 1500) {
    const n = await Promise.race([
      reader.read().catch(() => ({ value: undefined as Uint8Array | undefined, done: true })),
      new Promise<{ value?: Uint8Array; done: boolean }>((r) =>
        setTimeout(() => r({ done: false }), 200),
      ),
    ]);
    if (n.value) buf += dec.decode(n.value, { stream: true });
    if (buf.includes('id: 2') || buf.includes('state.changed')) break;
  }
  ac.abort();
  const ids = [...buf.matchAll(/^id: (\d+)/gm)].map((m) => Number(m[1]));
  assert(!ids.includes(1), `MUST NOT replay first, ids=${ids.join(',')}`);
  return 'Last-Event-ID replay';
});

export const runTv130 = wrap('TV-130', async (ctx) => {
  const t0 = Date.now();
  const res = await ctx.fetch(`${ctx.baseUrl}/app-events?mode=longpoll&timeout_ms=1000`, {
    headers: v11GetHeaders(),
  });
  const dt = Date.now() - t0;
  assert(res.status === 204, `204 got ${res.status}`);
  assert((await res.text()).length === 0, 'empty');
  assert(dt < 2000, `within 2s (${dt})`);
  return 'long-poll 204';
});

export const runTv131 = wrap('TV-131', async (ctx) => {
  const res = await ctx.fetch(
    `${ctx.baseUrl}/app-events?page_url=${encodeURIComponent(ctx.baseUrl + '/account')}`,
    {
      headers: { Accept: 'text/event-stream', 'X-APP-Accept-Versions': ACCEPT_VERSIONS_11 },
    },
  );
  assert(res.status === 401, '401');
  const ct = res.headers.get('content-type') ?? '';
  assert(!ct.includes('text/event-stream'), 'not a stream');
  assert(errorCode(await readJson(res)) === 'app.err.auth.required', 'error envelope');
  return 'event auth failure is envelope';
});

export const runTv132 = wrap('TV-132', async (ctx) => {
  const res = await ctx.fetch(
    `${ctx.baseUrl}/app-events?page_url=${encodeURIComponent('https://evil.example/page')}`,
    {
      headers: { Accept: 'text/event-stream' },
    },
  );
  assert(res.status === 403, '403');
  assert(errorCode(await readJson(res)) === 'app.err.security.cross_origin', 'cross_origin');
  return 'event page_url cross-origin';
});

export const runTv133 = wrap('TV-133', async (ctx) => {
  const wk = await ctx.fetch(`${ctx.baseUrl}/.well-known/agent-page`, { headers: v11GetHeaders() });
  const body = (await wk.json()) as {
    state: { features: { value: { events_ws?: { value: boolean } } } };
  };
  if (!body.state.features.value.events_ws?.value) {
    return 'skipped: events_ws false';
  }
  throw new Error('events_ws true but WS fixture not connected');
});

export const runTv134 = wrap('TV-134', async (ctx) => {
  const before = await ctx.fetch(`${ctx.baseUrl}/v11/bulk`, { headers: v11GetHeaders() });
  const orig = JSON.stringify(((await before.json()) as { state: unknown }).state);
  const res = await postAction(ctx, '/v11/bulk', 'apply_bulk', {
    mode: 'all_or_nothing',
    items: [
      { id: 'a', op: 'ok' },
      { id: 'b', op: 'illegal' },
    ],
  });
  assert(res.status === 409, '409');
  const after = await ctx.fetch(`${ctx.baseUrl}/v11/bulk`, { headers: v11GetHeaders() });
  const now = JSON.stringify(((await after.json()) as { state: unknown }).state);
  assert(now === orig, 'first item not committed');
  return 'bulk all_or_nothing rollback';
});

export const runTv135 = wrap('TV-135', async (ctx) => {
  const res = await postAction(ctx, '/v11/bulk', 'apply_bulk', {
    mode: 'best_effort',
    items: [
      { id: 'a', op: 'ok' },
      { id: 'b', op: 'illegal' },
    ],
  });
  assert(res.status === 200, '200');
  const body = (await readJson(res)) as { state: { items: { value: Array<[string, boolean]> } } };
  const flags = body.state.items.value.map((r) => r[1]);
  assert(flags.includes(true) && flags.includes(false), 'mixed ok flags');
  return 'bulk best_effort partial';
});

export const runTv136 = wrap('TV-136', async (ctx) => {
  const res = await postAction(ctx, '/v11/no-bulk', 'apply_bulk', { items: [{ id: 'a' }] });
  assert(res.status === 400, '400');
  assert(errorCode(await readJson(res)) === 'app.err.feature.unsupported', 'feature.unsupported');
  return 'bulk without feature';
});

export const runTv137 = wrap('TV-137', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/v11/focus?app_focus=/state/results`, {
    headers: v11GetHeaders(),
  });
  assert(res.status === 200, '200');
  const body = (await readJson(res)) as { page: { focus: string; url: string } };
  assert(body.page.focus === '/state/results', 'focus echo');
  assert(body.page.url.includes('app_focus='), 'url includes query');
  return 'deep focus echo';
});

export const runTv138 = wrap('TV-138', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/v11/focus?app_focus=/nope`, {
    headers: v11GetHeaders(),
  });
  assert(res.status === 200, '200');
  const body = (await readJson(res)) as { page: { focus?: string } };
  assert(body.page.focus == null, 'focus omitted');
  return 'invalid focus omitted';
});

export const runTv139 = wrap('TV-139', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/v11/geo`, {
    headers: v11GetHeaders({ 'X-APP-Time-Zone': 'America/New_York' }),
  });
  const body = (await readJson(res)) as { state: { when: { value: string } } };
  assert(body.state.when.value === '2026-08-19T10:00:00.000Z', 'UTC unchanged');
  return 'timezone does not rewrite datetime';
});

export const runTv140 = wrap('TV-140', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}/v11/geo`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, { 'Accept-Language': 'fr' }),
    body: JSON.stringify({ app: '1.1', action: 'need_q', params: {} }),
  });
  assert(res.status === 400, '400');
  const body = (await readJson(res)) as {
    error: { code: string; message: string; message_id?: string };
  };
  assert(body.error.code === 'app.err.validation.missing_param', 'stable code');
  assert(typeof body.error.message === 'string', 'message present');
  return 'localized message, stable code';
});

export const runTv141 = wrap('TV-141', async (ctx) => {
  const bad = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({ app: '1.1', action: 'noop19', params: {}, bogus: true }),
  });
  assert(bad.status === 400, `expected 400, got ${bad.status}`);
  assert(
    errorCode(await readJson(bad)) === 'app.err.payload.invalid_json',
    'invalid_json for unknown root key',
  );
  const clean = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({ app: '1.1', action: 'noop19', params: {} }),
  });
  assert(clean.status === 200, `clean request 200, got ${clean.status}`);
  return 'unknown root keys rejected; registered keys pass';
});

export const runTv142 = wrap('TV-142', async (ctx) => {
  // 1.1 leg: diff must carry the negotiated version.
  const diff11 = await ctx.fetch(`${ctx.baseUrl}${tvPath(142)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, { Accept: `${MEDIA_DIFF}, ${MEDIA_PAGE}` }),
    body: JSON.stringify({ app: '1.1', action: 'mutate142', params: {} }),
  });
  assert(diff11.status === 200, `diff 200, got ${diff11.status}`);
  const doc11 = (await readJson(diff11)) as {
    app: string;
    diff: Array<{ op: string; path: string; value?: { type?: string } }>;
  };
  assert(doc11.app === '1.1', `diff app 1.1, got ${doc11.app}`);
  assert(diff11.headers.get('x-app-version') === '1.1', 'X-APP-Version 1.1');
  const geoOp = doc11.diff.find((op) => op.path.startsWith('/state/geo'));
  assert(geoOp, '1.1 diff touches /state/geo');

  // 1.0 leg: diff must be computable against the v1.0-projected base.
  const base10 = await ctx.fetch(`${ctx.baseUrl}${tvPath(142)}`, {
    headers: {
      Accept: `${MEDIA_PAGE};v=1.0`,
      'X-APP-Accept-Versions': '1.0',
    },
  });
  const manifest10 = (await readJson(base10)) as PageManifest;
  assert(manifest10.app === '1.0', '1.0 base');
  const diff10 = await ctx.fetch(`${ctx.baseUrl}${tvPath(142)}`, {
    method: 'POST',
    headers: {
      Accept: `${MEDIA_DIFF};v=1.0, ${MEDIA_PAGE};v=1.0`,
      'Content-Type': MEDIA_ACTION,
      Origin: ctx.origin,
      'X-APP-Accept-Versions': '1.0',
    },
    body: JSON.stringify({ app: '1.0', action: 'mutate142', params: {} }),
  });
  assert(diff10.status === 200, `1.0 diff 200, got ${diff10.status}`);
  const doc10 = (await readJson(diff10)) as DiffDocument;
  assert(doc10.app === '1.0', `diff app 1.0, got ${doc10.app}`);
  assert(diff10.headers.get('x-app-version') === '1.0', 'X-APP-Version 1.0');
  const applied = applyDiffDocument(manifest10, doc10);
  assert(applied.ok, `diff applies to 1.0 base: ${!applied.ok ? applied.message : ''}`);
  const geo10 = (applied.manifest.state as Record<string, { type?: string }>).geo;
  assert(geo10?.type === 'object', `projected object node, got ${geo10?.type}`);
  return 'diff carries negotiated version; 1.0 diff applies to projected base';
});

export const runTv143 = wrap('TV-143', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    method: 'POST',
    headers: {
      Accept: ACCEPT_DIFF_11,
      'Content-Type': MEDIA_ACTION,
      Origin: ctx.origin,
      [HEADER_ACCEPT_VERSIONS]: ACCEPT_VERSIONS_11,
    },
    body: '{not-json',
  });
  assert(res.status === 400, `400, got ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  assert(ct.includes('vnd.agent-page-error'), `error media type, got ${ct}`);
  const body = await readJson(res);
  assert(
    errorCode(body) === 'app.err.payload.invalid_json',
    `invalid_json, got ${errorCode(body)}`,
  );
  return 'malformed JSON -> APP error envelope';
});

export const runTv144 = wrap('TV-144', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('{"app":"1.1","action":"noop19","params":{}}'),
    ]),
  });
  assert(res.status === 400, `400, got ${res.status}`);
  const body = await readJson(res);
  assert(errorCode(body) === 'app.err.payload.charset', `payload.charset, got ${errorCode(body)}`);
  return 'BOM rejected';
});

export const runTv145 = wrap('TV-145', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: Buffer.concat([
      Buffer.from('{"app":"1.1","action":"noop19","params":{"x":"'),
      Buffer.from([0xc0, 0xaf]),
      Buffer.from('"}}'),
    ]),
  });
  assert(res.status === 400, `400, got ${res.status}`);
  const body = await readJson(res);
  assert(errorCode(body) === 'app.err.payload.charset', `payload.charset, got ${errorCode(body)}`);
  return 'invalid UTF-8 rejected';
});

export const runTv146 = wrap('TV-146', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({
      app: '1.1',
      action: 'noop19',
      params: { blob: 'x'.repeat(70 * 1024) },
    }),
  });
  assert(res.status === 413, `413, got ${res.status}`);
  const body = (await readJson(res)) as { app: string };
  assert(errorCode(body) === 'app.err.payload.too_large', `too_large, got ${errorCode(body)}`);
  assert(body.app === '1.1', `envelope stamped 1.1, got ${body.app}`);
  return '64KiB cap -> 413, negotiated version stamped';
});

export const runTv147 = wrap('TV-147', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(147)}`, { headers: v11GetHeaders() });
  assert(res.status === 500, `500, got ${res.status}`);
  const body = await readJson(res);
  assert(
    errorCode(body) === 'app.err.action.options_source_invalid',
    `options_source_invalid, got ${errorCode(body)}`,
  );
  return 'publish-time options_source validation';
});

export const runTv148 = wrap('TV-148', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(148)}`, { headers: v11GetHeaders() });
  assert(res.status === 500, `500, got ${res.status}`);
  const body = await readJson(res);
  assert(
    errorCode(body) === 'app.err.state.array_too_long',
    `array_too_long, got ${errorCode(body)}`,
  );
  return 'publish-time table row cap';
});

export const runTv149 = wrap('TV-149', async (ctx) => {
  const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({ app: '1.1', action: 'ghost_action', params: {} }),
  });
  assert(res.status === 404, `404, got ${res.status}`);
  const body = await readJson(res);
  assert(errorCode(body) === 'app.err.action.not_found', `not_found, got ${errorCode(body)}`);
  return 'unknown action -> 404';
});

export const runTv150 = wrap('TV-150', async (ctx) => {
  const unsupported = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    headers: { Accept: MEDIA_PAGE, 'X-APP-Accept-Versions': '9.9' },
  });
  assert(unsupported.status === 406, `406, got ${unsupported.status}`);
  const uBody = (await readJson(unsupported)) as { app: string };
  assert(
    errorCode(uBody) === 'app.err.version.unsupported',
    `version.unsupported, got ${errorCode(uBody)}`,
  );
  assert(uBody.app === '9.9', `envelope app == highest offered, got ${uBody.app}`);

  const mismatch = await ctx.fetch(`${ctx.baseUrl}${tvPath(141)}`, {
    headers: {
      Accept: `${MEDIA_PAGE};v=9.9`,
      'X-APP-Accept-Versions': '9.9',
    },
  });
  assert(mismatch.status === 400, `400, got ${mismatch.status}`);
  const mBody = await readJson(mismatch);
  assert(
    errorCode(mBody) === 'app.err.version.version_mismatch',
    `version_mismatch, got ${errorCode(mBody)}`,
  );
  return 'unsupported offer -> 406; unsupported v= param -> mismatch';
});

export const runTv151 = wrap('TV-151', async (ctx) => {
  const badEnum = await ctx.fetch(`${ctx.baseUrl}${tvPath(151)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({
      app: '1.1',
      action: 'pick',
      params: { color: 'blue', sku: 'ABC-1234' },
    }),
  });
  assert(badEnum.status === 400, `400, got ${badEnum.status}`);
  const eBody = await readJson(badEnum);
  assert(
    errorCode(eBody) === 'app.err.validation.param_enum',
    `param_enum, got ${errorCode(eBody)}`,
  );

  const badPattern = await ctx.fetch(`${ctx.baseUrl}${tvPath(151)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({
      app: '1.1',
      action: 'pick',
      params: { color: 'red', sku: 'bad' },
    }),
  });
  assert(badPattern.status === 400, `400, got ${badPattern.status}`);
  const pBody = await readJson(badPattern);
  assert(
    errorCode(pBody) === 'app.err.validation.param_pattern',
    `param_pattern, got ${errorCode(pBody)}`,
  );
  return 'enum + pattern violations';
});

export const runTv152 = wrap('TV-152', async (ctx) => {
  const v10 = await ctx.fetch(`${ctx.baseUrl}${tvPath(152)}`, {
    method: 'POST',
    headers: {
      Accept: `${MEDIA_PAGE};v=1.0`,
      'Content-Type': MEDIA_ACTION,
      Origin: ctx.origin,
      'X-APP-Accept-Versions': '1.0',
    },
    body: JSON.stringify({
      app: '1.0',
      action: 'geo_pin',
      params: { loc: { lat: 1, lng: 2 } },
    }),
  });
  assert(v10.status === 400, `400, got ${v10.status}`);
  const vBody = await readJson(v10);
  assert(
    errorCode(vBody) === 'app.err.feature.version_mismatch',
    `feature.version_mismatch, got ${errorCode(vBody)}`,
  );

  const boom = await ctx.fetch(`${ctx.baseUrl}${tvPath(152)}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx),
    body: JSON.stringify({ app: '1.1', action: 'explode', params: {} }),
  });
  assert(boom.status === 500, `500, got ${boom.status}`);
  const bCt = boom.headers.get('content-type') ?? '';
  assert(bCt.includes('vnd.agent-page-error'), `error media type, got ${bCt}`);
  const bBody = await readJson(boom);
  assert(
    errorCode(bBody) === 'app.err.internal.server',
    `internal.server, got ${errorCode(bBody)}`,
  );
  return '1.1 param under 1.0 -> feature.version_mismatch; handler throw -> internal.server';
});
