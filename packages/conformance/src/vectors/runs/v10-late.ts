/**
 * Vector run implementations TV-40..TV-60.
 */

import { fileURLToPath } from 'node:url';
import { validateStateRoot } from '@agent-page/server';
import {
  AgentClient,
  ManifestCache,
  applyDiffDocument as clientApplyDiff,
  assertSameOrigin,
  expandUrlTemplate,
  NavigationStack,
  MAX_REDIRECTS,
} from '@agent-page/client';
import type { VectorContext } from '../types.js';
import { pass, fail } from '../types.js';
import { ACCEPT_PAGE, assert, errorCode, readJson, tvPath, actionHeaders } from '../helpers.js';
import { fetchWithAuthRefresh } from './auth-refresh.js';

type Run = (ctx: VectorContext) => Promise<ReturnType<typeof pass>>;
export const runTv40: Run = async (ctx) => {
  const id = 'TV-40';
  try {
    const city = 'München';
    const expected = expandUrlTemplate(
      `${ctx.baseUrl}${tvPath(40)}/r?city={city}`,
      { city },
      ctx.baseUrl,
    );
    assert(!expected.includes('ü'), 'no raw unicode');
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(40)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({ app: '1.0', action: 'search', params: { city } }),
      redirect: 'manual',
    });
    const loc = res.headers.get('Location') ?? res.headers.get('X-APP-Navigate');
    assert(loc === expected, `encoded URL ${loc} vs ${expected}`);
    return pass(id, 'Unicode template percent-encoded');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv41: Run = async (ctx) => {
  const id = 'TV-41';
  try {
    const stack = new NavigationStack();
    const a = `${ctx.baseUrl}${tvPath(41)}/a`;
    const b = `${ctx.baseUrl}${tvPath(41)}/b`;
    let cycleThrown = false;
    try {
      stack.push(a);
      stack.push(b);
      stack.push(a);
      stack.push(b);
      stack.push(a);
    } catch (e) {
      cycleThrown = (e as { code?: string }).code === 'app.err.navigation.cycle';
    }
    assert(cycleThrown, 'cycle detected on push');
    return pass(id, 'Navigation cycle detected in stack');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv42: Run = async (ctx) => {
  const id = 'TV-42';
  try {
    assert(MAX_REDIRECTS <= 5, 'redirect budget');
    // Fixture: /vectors/tv-42/a 303s to /b which 303s back to /a.
    const client = new AgentClient({ fetch: ctx.fetch });
    let code = '';
    try {
      await client.hydrate(`${ctx.baseUrl}${tvPath(42)}/a`);
    } catch (e) {
      code = (e as { code?: string }).code ?? '';
    }
    assert(
      code === 'app.err.navigation.redirect_loop' || code === 'app.err.navigation.cycle',
      `loop abort, got ${code || 'no error'}`,
    );
    return pass(id, `Redirect loop aborted client-side (${code})`);
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv43: Run = async (ctx) => {
  const id = 'TV-43';
  try {
    let threw = false;
    try {
      assertSameOrigin('https://evil.example/page', ctx.baseUrl);
    } catch (e) {
      threw = true;
      assert(
        String(e).includes('cross_origin') ||
          (e as { code?: string }).code === 'app.err.security.cross_origin',
        'cross_origin',
      );
    }
    assert(threw, 'cross-origin blocked');
    return pass(id, 'Cross-origin navigation blocked');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv44: Run = async (ctx) => {
  const id = 'TV-44';
  try {
    const bad = await ctx.fetch(`${ctx.baseUrl}${tvPath(44)}`, {
      method: 'POST',
      headers: {
        ...actionHeaders(ctx),
        Origin: 'https://evil.example',
        'X-APP-Origin': ctx.origin,
        Cookie: 'session=csrf',
      },
      body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
    });
    assert(bad.status === 403, '403');
    assert(errorCode(await readJson(bad)) === 'app.err.security.csrf', 'csrf');
    return pass(id, 'CSRF Origin precedence');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv45: Run = async (ctx) => {
  const id = 'TV-45';
  try {
    const params = { amount: 42 };
    const rawBody = JSON.stringify({ app: '1.0', action: 'confirm_pay', params });
    const ch = await ctx.fetch(`${ctx.baseUrl}${tvPath(45)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-Idempotency-Key': 'idem_tv45', Cookie: 'session=tv45' }),
      body: rawBody,
    });
    assert(ch.status === 428, '428');
    const token = (
      (await readJson(ch)) as { error: { details: { confirmation_challenge: { value: string } } } }
    ).error.details.confirmation_challenge.value;
    const ok = await ctx.fetch(`${ctx.baseUrl}${tvPath(45)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, {
        'X-APP-Idempotency-Key': 'idem_tv45',
        'X-APP-Confirmation': token,
        'X-APP-If-Match-Version': 'v1',
        Cookie: 'session=tv45',
      }),
      body: rawBody,
    });
    assert(ok.status === 200, 'confirmed 200');
    return pass(id, 'Mode A confirmation 428→200');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv46: Run = async (ctx) => {
  const id = 'TV-46';
  try {
    const original = { amount: 10, currency: 'GBP' };
    const ch = await ctx.fetch(`${ctx.baseUrl}${tvPath(46)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, {
        'X-APP-Idempotency-Key': 'idem_tv46a',
        Cookie: 'session=tv46',
      }),
      body: JSON.stringify({ app: '1.0', action: 'pay', params: original }),
    });
    assert(ch.status === 428, '428');
    const token = (
      (await readJson(ch)) as { error: { details: { confirmation_challenge: { value: string } } } }
    ).error.details.confirmation_challenge.value;
    const bad = await ctx.fetch(`${ctx.baseUrl}${tvPath(46)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, {
        'X-APP-Confirmation': token,
        'X-APP-Idempotency-Key': 'idem_tv46b',
        Cookie: 'session=tv46',
      }),
      body: JSON.stringify({ app: '1.0', action: 'pay', params: { amount: 99, currency: 'USD' } }),
    });
    assert(bad.status === 403, '403');
    assert(errorCode(await readJson(bad)) === 'app.err.action.confirmation_invalid', 'invalid');
    return pass(id, 'Confirmation mutation rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv47: Run = async (ctx) => {
  const id = 'TV-47';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(47)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, {
        'X-APP-Client': 'agent/1.0',
        'X-APP-Confirmation': 'uuid-mode:deadbeef',
        'X-APP-Idempotency-Key': 'idem_tv47',
      }),
      body: JSON.stringify({ app: '1.0', action: 'sensitive', params: {} }),
    });
    assert(res.status === 403, '403');
    assert(
      errorCode(await readJson(res)) === 'app.err.action.confirmation_invalid',
      'Mode B rejected',
    );
    return pass(id, 'Mode B uuid confirmation rejected for agent');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv48: Run = async (ctx) => {
  const id = 'TV-48';
  try {
    const h = actionHeaders(ctx, { Cookie: 'session=rate48' });
    const body = JSON.stringify({ app: '1.0', action: 'ping', params: {} });
    await ctx.fetch(`${ctx.baseUrl}${tvPath(48)}`, { method: 'POST', headers: h, body });
    const limited = await ctx.fetch(`${ctx.baseUrl}${tvPath(48)}`, {
      method: 'POST',
      headers: h,
      body,
    });
    assert(limited.status === 429, '429');
    const retryAfter = Number(limited.headers.get('Retry-After'));
    assert(retryAfter >= 1, 'Retry-After');
    // Wait out the window, then the same request must succeed (windowed reset).
    await new Promise((r) => setTimeout(r, retryAfter * 1000 + 150));
    const after = await ctx.fetch(`${ctx.baseUrl}${tvPath(48)}`, {
      method: 'POST',
      headers: h,
      body,
    });
    assert(after.status === 200, `post-window 200, got ${after.status}`);
    return pass(id, '429 + Retry-After honored; request succeeds after window reset');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv49: Run = async (ctx) => {
  const id = 'TV-49';
  try {
    // Seed expired token via refresh endpoint contract
    await ctx.fetch(`${ctx.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'refresh_ok' }),
    });

    let access = 'access_expired';
    const ok = await fetchWithAuthRefresh(
      ctx,
      `${ctx.baseUrl}${tvPath(49)}`,
      { method: 'GET' },
      {
        accessToken: access,
        refreshToken: 'refresh_ok',
        setAccessToken: (t) => {
          access = t;
        },
      },
    );
    assert(ok.outcome === 'ok' && ok.response.status === 200, 'refresh path');

    const failPath = await fetchWithAuthRefresh(
      ctx,
      `${ctx.baseUrl}${tvPath(49)}`,
      { method: 'GET' },
      {
        accessToken: 'access_expired',
        refreshToken: 'refresh_fail',
        setAccessToken: () => {},
      },
    );
    assert(failPath.outcome === 'surface', 'surface second 401');
    return pass(id, 'Auth refresh retry-once');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv50: Run = async (ctx) => {
  const id = 'TV-50';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(50)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'run_job', params: {} }),
    });
    assert(res.status === 202, `expected 202, got ${res.status}`);
    assert(res.headers.get('X-APP-Response-Mode') === 'async', 'X-APP-Response-Mode async');
    const body = (await readJson(res)) as {
      state: { operation_status: { value: { status_url: { value: string } } } };
      meta?: { poll_interval_ms?: number };
    };
    const statusUrl = body.state.operation_status.value.status_url.value;
    assert(typeof statusUrl === 'string' && statusUrl.length > 0, 'status_url');
    await new Promise((r) => setTimeout(r, body.meta?.poll_interval_ms ?? 50));
    const poll = await ctx.fetch(statusUrl, { headers: { Accept: ACCEPT_PAGE } });
    assert(poll.status === 200, 'terminal poll');
    const done = (await readJson(poll)) as { state: { status?: { value: string } } };
    assert(done.state.status?.value === 'done', 'succeeded terminal state');
    return pass(id, 'Async 202 lifecycle');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv51: Run = async (ctx) => {
  const id = 'TV-51';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(51)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'fail_job', params: {} }),
    });
    assert(res.status === 202 || res.status === 200, 'async started');
    const accepted = (await readJson(res)) as {
      state: { operation_status: { value: { status_url: { value: string } } } };
      meta?: { poll_interval_ms?: number };
    };
    const statusUrl = accepted.state.operation_status.value.status_url.value;
    await new Promise((r) => setTimeout(r, accepted.meta?.poll_interval_ms ?? 50));
    const poll = await ctx.fetch(statusUrl, { headers: { Accept: ACCEPT_PAGE } });
    assert(poll.status === 200, 'terminal poll 200');
    const done = (await readJson(poll)) as {
      state: { operation_status: { value: { state: { value: string } } } };
      actions?: Record<string, unknown>;
      error?: { code: string; recoverable_actions?: string[] };
    };
    assert(done.state.operation_status.value.state.value === 'failed', 'terminal state failed');
    assert(done.error?.code === 'app.err.action.async_failed', 'async_failed soft error');
    assert(
      (done.error?.recoverable_actions ?? []).includes('retry'),
      'recoverable_actions lists retry',
    );
    assert(done.actions?.retry !== undefined, 'retry action advertised');
    return pass(id, 'Async terminal failed + recoverable_actions');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv52: Run = async (ctx) => {
  const id = 'TV-52';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(52)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status === 200, '200');
    const body = (await readJson(res)) as { error?: { code: string } };
    const code = body.error?.code ?? '';
    const softWhitelist = new Set([
      'app.err.partial.results',
      'app.err.action.async_pending',
      'app.err.action.async_failed',
      'app.err.partial.action',
      'app.err.cache.stale',
    ]);
    assert(!softWhitelist.has(code) && code.includes('internal'), 'hard code not whitelisted');
    return pass(id, 'Non-whitelisted soft channel abuse detectable');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv53: Run = async (ctx) => {
  const id = 'TV-53';
  try {
    const get = await ctx.fetch(`${ctx.baseUrl}${tvPath(53)}`, {
      headers: { Accept: ACCEPT_PAGE, Origin: 'https://reader.example' },
    });
    assert(get.status === 200 || get.status === 404, 'GET may succeed with cors_read');
    const post = await ctx.fetch(`${ctx.baseUrl}${tvPath(53)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { Origin: 'https://reader.example' }),
      body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
    });
    assert(post.status === 403, 'cross-origin POST rejected');
    return pass(id, 'CORS read vs write separation');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv54: Run = async (ctx) => {
  const id = 'TV-54';
  try {
    const first = await ctx.fetch(`${ctx.baseUrl}${tvPath(54)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const etag = first.headers.get('ETag');
    assert(etag != null, 'ETag');
    const second = await ctx.fetch(`${ctx.baseUrl}${tvPath(54)}`, {
      headers: { Accept: ACCEPT_PAGE, 'If-None-Match': etag },
    });
    assert(second.status === 304, '304');
    assert((await second.text()).length === 0, 'empty 304 body');
    return pass(id, 'Conditional GET 304');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv55: Run = async (ctx) => {
  const id = 'TV-55';
  try {
    // §4.5: private manifests keyed by session_epoch; logout purges them.
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(1)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const manifest = (await readJson(res)) as import('@agent-page/client').PageManifest;
    const url = `${ctx.baseUrl}${tvPath(49)}`;
    const cache = new ManifestCache();
    cache.set(url, manifest, { private: true });
    assert(cache.get(url) !== undefined, 'private entry cached');
    cache.purgeOnLogout(ctx.origin);
    assert(cache.get(url) === undefined, 'logout purges private entries');
    // Epoch bump likewise invalidates without an explicit logout.
    cache.set(url, manifest, { private: true });
    cache.setSessionEpoch(ctx.origin, 7);
    assert(cache.get(url) === undefined, 'epoch change invalidates private entries');
    return pass(id, 'Private cache purged on logout / session-epoch change');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv56: Run = async (ctx) => {
  const id = 'TV-56';
  try {
    // v0.4 §5.2 invariant 9: 401/403 on a file URL -> revalidate the parent
    // manifest fresh, retry once against the URL it now advertises, verify sha256.
    const client = new AgentClient({ fetch: ctx.fetch });
    const manifest = await client.hydrate(`${ctx.baseUrl}${tvPath(56)}`);
    const docNode = manifest.state.doc;
    assert(docNode?.type === 'file', 'doc is a file node');
    const file = await client.downloadFile(manifest, 'doc');
    const text = new TextDecoder().decode(file.bytes);
    assert(text === 'doc-ok-bytes', `fresh bytes after revalidation, got ${text}`);
    assert(file.manifest !== manifest, 'parent manifest revalidated');
    return pass(id, 'File URL 403 -> parent revalidated -> fresh signed URL downloaded');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv57: Run = async (ctx) => {
  const id = 'TV-57';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(57)}`, {
      method: 'POST',
      headers: {
        ...actionHeaders(ctx),
        'Content-Type': 'multipart/form-data; boundary=---bound',
      },
      body: '---bound\r\nContent-Disposition: form-data; name="file"\r\n\r\nx\r\n---bound--\r\n',
    });
    assert(res.status === 415, '415');
    assert(
      errorCode(await readJson(res)) === 'app.err.action.upload_unsupported',
      'upload_unsupported',
    );
    return pass(id, 'Upload without capability rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv58: Run = async (ctx) => {
  const id = 'TV-58';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(58)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status === 200, '200');
    const body = (await readJson(res)) as {
      state: { results: { value: unknown[] } };
      meta?: { truncated?: boolean };
    };
    // §5.6: capped collection MUST declare truncation — has_more + meta.truncated
    // + a paginate action taking the emitted cursor. Silent truncation is a violation.
    const results = body.state.results as unknown as {
      value: unknown[];
      pagination?: { has_more?: boolean; cursor?: unknown };
    };
    assert(results.value.length > 0, 'rows present');
    assert(results.pagination?.has_more === true, 'pagination.has_more');
    assert(typeof results.pagination?.cursor === 'string', 'pagination.cursor');
    const meta = (body as { meta?: { truncated?: boolean } }).meta;
    assert(meta?.truncated === true, 'meta.truncated');
    const paginate = (
      body as { actions?: Record<string, { input?: Record<string, { required?: boolean }> }> }
    ).actions?.next_page;
    assert(paginate?.input?.cursor?.required === true, 'paginate action takes cursor');
    const err = validateStateRoot(body.state);
    assert(err == null, 'valid truncated table');
    return pass(id, 'Truncated collection declares has_more + meta.truncated + paginate');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv59: Run = async (_ctx) => {
  const id = 'TV-59';
  try {
    // §24 closed tagged-union: receivers drop unknown types/versions via the
    // real extension predicate (imported — no extension host needed).
    const messagesPath = fileURLToPath(
      new URL('../../../../../extension/protocol/messages.js', import.meta.url),
    );
    const { isAppExtMessage, createMessage } = (await import(messagesPath)) as {
      isAppExtMessage: (m: unknown) => boolean;
      createMessage: (t: string) => unknown;
    };
    assert(
      isAppExtMessage({ app_ext: '1.0', type: 'NOPE', payload: {} }) === false,
      'unknown dropped',
    );
    assert(
      isAppExtMessage({ app_ext: '2.0', type: 'PING', payload: {} }) === false,
      'bad version dropped',
    );
    assert(!isAppExtMessage(null) && !isAppExtMessage('x'), 'non-envelope dropped');
    let threw = false;
    try {
      createMessage('NOPE');
    } catch {
      threw = true;
    }
    assert(threw, 'closed catalog refuses to construct unknown type');
    return pass(id, 'Unknown message dropped via isAppExtMessage; catalog closed at construct');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv60: Run = async (ctx) => {
  const id = 'TV-60';
  try {
    const get1 = await ctx.fetch(`${ctx.baseUrl}${tvPath(60)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const before = (await readJson(get1)) as import('@agent-page/client').PageManifest;
    const post = await ctx.fetch(`${ctx.baseUrl}${tvPath(60)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': before.page.version }),
      body: JSON.stringify({ app: '1.0', action: 'inc', params: { delta: 2 } }),
    });
    assert(post.status === 200, 'action ok');
    const diffDoc = (await readJson(post)) as import('@agent-page/client').DiffDocument;
    const sanitized = {
      ...diffDoc,
      diff: diffDoc.diff.filter((op) => op.path !== '/page/version'),
    };
    const applied = clientApplyDiff(before, sanitized);
    assert(applied.ok, `apply ok: ${!applied.ok ? applied.message : ''}`);
    if (applied.ok) {
      applied.manifest.page.version = diffDoc.result_version;
    }
    const get2 = await ctx.fetch(`${ctx.baseUrl}${tvPath(60)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const fresh = (await readJson(get2)) as import('@agent-page/client').PageManifest;
    assert(
      JSON.stringify(applied.manifest.state) === JSON.stringify(fresh.state),
      'semantic equality after round-trip',
    );
    return pass(id, 'Diff round-trip coherence');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};
