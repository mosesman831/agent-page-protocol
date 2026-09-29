/**
 * Vector run implementations TV-05..TV-39.
 */

import { validateStateNode, validateStateRoot } from '@agent-page/server';
import {
  AgentClient,
  applyDiffDocument as clientApplyDiff,
  validateDiffOps,
} from '@agent-page/client';
import type { VectorContext } from '../types.js';
import { pass, fail } from '../types.js';
import {
  ACCEPT_PAGE,
  ACCEPT_DIFF_ONLY,
  assert,
  errorCode,
  errorPath,
  readJson,
  tvPath,
  actionHeaders,
  getWithBody,
  httpGet,
} from '../helpers.js';

type Run = (ctx: VectorContext) => Promise<ReturnType<typeof pass>>;
export const runTv05: Run = async (ctx) => {
  const id = 'TV-05';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(5)}`, { headers: { Accept: ACCEPT_PAGE } });
    assert(
      res.status === 502 || res.status === 500 || res.status === 400,
      `expected emit rejection, got ${res.status}`,
    );
    assert(errorCode(await readJson(res)) === 'app.err.state.invalid_enum', 'invalid_enum');
    return pass(id, 'Enum value outside options rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv06: Run = async (ctx) => {
  const id = 'TV-06';
  try {
    const dup = await ctx.fetch(`${ctx.baseUrl}${tvPath(6)}`, { headers: { Accept: ACCEPT_PAGE } });
    assert(dup.status >= 400, 'duplicate options rejected');
    assert(errorCode(await readJson(dup)) === 'app.err.state.invalid_enum', 'dup enum');
    const many = await ctx.fetch(`${ctx.baseUrl}${tvPath(6)}/too-many`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(many.status >= 400, '257 options rejected');
    return pass(id, 'Duplicate and oversized enum options rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv07: Run = async (ctx) => {
  const id = 'TV-07';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(7)}`, { headers: { Accept: ACCEPT_PAGE } });
    assert(res.status === 200, '200');
    const body = (await readJson(res)) as { state: { n: { value: number } } };
    assert(body.state.n.value === 0, '-0 normalized to 0');
    assert(Object.is(body.state.n.value, 0) && !Object.is(body.state.n.value, -0), 'value is +0');
    return pass(id, 'Negative zero normalized');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv08: Run = async (ctx) => {
  const id = 'TV-08';
  try {
    const bad = await ctx.fetch(`${ctx.baseUrl}${tvPath(8)}`, { headers: { Accept: ACCEPT_PAGE } });
    assert(bad.status >= 400, '2^53 rejected');
    const code = errorCode(await readJson(bad));
    assert(
      code === 'app.err.state.number_precision' || code === 'app.err.state.number_overflow',
      code ?? 'missing code',
    );
    const ok = await ctx.fetch(`${ctx.baseUrl}${tvPath(8)}/ok`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(ok.status === 200, '2^53-1 allowed');
    return pass(id, 'Integer precision boundary enforced');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv09: Run = async (ctx) => {
  const id = 'TV-09';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(9)}`, { headers: { Accept: ACCEPT_PAGE } });
    assert(res.status >= 400, 'non-integer money rejected');
    assert(errorCode(await readJson(res)) === 'app.err.state.invalid_node', 'invalid_node');
    const local = validateStateNode({ type: 'number', value: 10.5, scale: 2 });
    assert(local?.code === 'app.err.state.invalid_node', 'local scale check');
    return pass(id, 'Money scale requires integer value');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv10: Run = async (ctx) => {
  const id = 'TV-10';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(10)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status >= 400, 'invalid date rejected');
    assert(errorCode(await readJson(res)) === 'app.err.state.invalid_date', 'invalid_date');
    return pass(id, 'Invalid calendar date rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv11: Run = async (ctx) => {
  const id = 'TV-11';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(11)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status >= 400, 'datetime without offset rejected');
    assert(errorCode(await readJson(res)) === 'app.err.state.invalid_datetime', 'invalid_datetime');
    return pass(id, 'Datetime without offset rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv12: Run = async (ctx) => {
  const id = 'TV-12';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(12)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status >= 400, 'illegal key rejected');
    assert(errorCode(await readJson(res)) === 'app.err.state.illegal_key', 'illegal_key');
    const crafted = JSON.parse(
      '{"bad":{"type":"object","value":{"__proto__":{"type":"string","value":"x"}}}}',
    );
    const local = validateStateRoot(crafted);
    assert(local?.code === 'app.err.state.illegal_key', 'local __proto__ check');
    return pass(id, 'Illegal object key rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv13: Run = async (ctx) => {
  const id = 'TV-13';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(13)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status >= 400, 'table row mismatch rejected');
    assert(errorCode(await readJson(res)) === 'app.err.state.invalid_node', 'invalid_node');
    return pass(id, 'Table row length mismatch rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv14: Run = async (ctx) => {
  const id = 'TV-14';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(14)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status >= 400, 'bad file name rejected');
    assert(errorCode(await readJson(res)) === 'app.err.state.invalid_file', 'invalid_file');
    return pass(id, 'File name with slash rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv15: Run = async (ctx) => {
  const id = 'TV-15';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(15)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    assert(res.status >= 400, 'http non-loopback file rejected');
    assert(errorCode(await readJson(res)) === 'app.err.state.invalid_file', 'invalid_file');
    return pass(id, 'Non-loopback http file URL rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv16: Run = async (ctx) => {
  const id = 'TV-16';
  try {
    const bad = await httpGet(`${ctx.baseUrl}/.well-known/agent-page-invalid`, {
      Accept: ACCEPT_PAGE,
    });
    assert(bad.status === 502, `expected 502, got ${bad.status}`);
    assert(
      errorCode(JSON.parse(bad.body)) === 'app.err.discovery.invalid_well_known',
      'invalid_well_known',
    );
    const ok = await httpGet(`${ctx.baseUrl}/.well-known/agent-page`, { Accept: ACCEPT_PAGE });
    assert(ok.status === 200, 'valid well-known');
    return pass(id, 'Well-known capability validation');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv17: Run = async (ctx) => {
  const id = 'TV-17';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}/.well-known/agent-page/`, { redirect: 'manual' });
    assert(res.status === 308, `expected 308, got ${res.status}`);
    assert(res.headers.get('Location')?.endsWith('/.well-known/agent-page'), 'redirect target');
    return pass(id, 'Trailing slash 308 redirect');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv18: Run = async (ctx) => {
  const id = 'TV-18';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(18)}`, { headers: { Accept: '*/*' } });
    const ct = res.headers.get('content-type') ?? '';
    assert(res.status === 200, '200');
    assert(ct.includes('text/html') || ct.includes('vnd.agent-page'), `non-APP default: ${ct}`);
    return pass(id, 'Dual-mode */* returns HTML or default');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv19: Run = async (ctx) => {
  const id = 'TV-19';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(19)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { Accept: ACCEPT_DIFF_ONLY }),
      body: JSON.stringify({ app: '1.0', action: 'noop', params: {} }),
    });
    assert(res.status === 406 || res.status === 200, `406 or full fallback, got ${res.status}`);
    if (res.status === 406) {
      assert(
        errorCode(await readJson(res)) === 'app.err.negotiate.diff_unsupported',
        'diff_unsupported',
      );
    }
    return pass(id, 'Diff-only negotiation handled');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv20: Run = async (ctx) => {
  const id = 'TV-20';
  try {
    const res = await getWithBody(`${ctx.baseUrl}${tvPath(1)}`, '{}', {
      Accept: ACCEPT_PAGE,
      'Content-Type': 'application/json',
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const body = JSON.parse(res.body);
    assert(errorCode(body) === 'app.err.payload.unexpected_body', 'unexpected_body');
    return pass(id, 'GET with body rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv21: Run = async (ctx) => {
  const id = 'TV-21';
  try {
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(1)}`, {
        method,
        headers: { Accept: ACCEPT_PAGE },
      });
      assert(res.status === 405, `${method} → 405`);
      assert(res.headers.get('Allow')?.includes('GET'), 'Allow header');
      assert(
        errorCode(await readJson(res)) === 'app.err.transport.method_not_allowed',
        'method_not_allowed',
      );
    }
    return pass(id, 'PUT/DELETE return 405');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv22: Run = async (ctx) => {
  const id = 'TV-22';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(22)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({
        app: '1.0',
        action: 'set_n',
        params: { n: { type: 'number', value: 1 } },
      }),
    });
    assert(res.status === 400, '400');
    assert(errorCode(await readJson(res)) === 'app.err.validation.param_type', 'param_type');
    return pass(id, 'StateNode-wrapped params rejected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv23: Run = async (ctx) => {
  const id = 'TV-23';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(23)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({ app: '1.0', action: 'need_x', params: {} }),
    });
    assert(res.status === 400, '400');
    const body = await readJson(res);
    assert(errorCode(body) === 'app.err.validation.missing_param', 'missing_param');
    assert(errorPath(body) != null, 'error.path present');
    return pass(id, 'Missing required param');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv24: Run = async (ctx) => {
  const id = 'TV-24';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(24)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({ app: '1.0', action: 'touch_strict', params: { extra: 'x' } }),
    });
    assert(res.status === 400, '400');
    assert(errorCode(await readJson(res)) === 'app.err.validation.unknown_param', 'unknown_param');
    return pass(id, 'Unknown param strict mode');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv25: Run = async (ctx) => {
  const id = 'TV-25';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(25)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'touch_lenient', params: { extra: 'ignored' } }),
    });
    assert(res.status === 200, 'lenient ignores unknown');
    return pass(id, 'Lenient param_mode ignores unknown key');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv26: Run = async (ctx) => {
  const id = 'TV-26';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(26)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({ app: '1.0', action: 'charge', params: { amount: 100 } }),
    });
    assert(res.status === 400, '400');
    assert(
      errorCode(await readJson(res)) === 'app.err.validation.idempotency_key_required',
      'idempotency required',
    );
    return pass(id, 'Financial action requires idempotency key');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv27: Run = async (ctx) => {
  const id = 'TV-27';
  try {
    const key = 'idem_tv27';
    const body = JSON.stringify({ app: '1.0', action: 'add', params: { amount: 3 } });
    const headers = actionHeaders(ctx, {
      'X-APP-Idempotency-Key': key,
      'X-APP-If-Match-Version': 'v1',
    });
    const first = await ctx.fetch(`${ctx.baseUrl}${tvPath(27)}`, { method: 'POST', headers, body });
    assert(first.status === 200, 'first 200');
    const firstText = await first.text();
    // Replay with the *same* If-Match-Version (v1) — idempotency lookup must run
    // before version check so a bumped page.version does not 409 the replay.
    const replay = await ctx.fetch(`${ctx.baseUrl}${tvPath(27)}`, {
      method: 'POST',
      headers,
      body,
    });
    assert(replay.status === 200, `replay 200, got ${replay.status}`);
    assert((await replay.text()) === firstText, 'byte-equal replay');
    return pass(id, 'Idempotency replay byte-equal');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv28: Run = async (ctx) => {
  const id = 'TV-28';
  try {
    const key = 'idem_tv28';
    const h = actionHeaders(ctx, { 'X-APP-Idempotency-Key': key, 'X-APP-If-Match-Version': 'v1' });
    await ctx.fetch(`${ctx.baseUrl}${tvPath(28)}`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ app: '1.0', action: 'add', params: { amount: 1 } }),
    });
    const conflict = await ctx.fetch(`${ctx.baseUrl}${tvPath(28)}`, {
      method: 'POST',
      headers: { ...h, 'X-APP-If-Match-Version': 'v2' },
      body: JSON.stringify({ app: '1.0', action: 'add', params: { amount: 9 } }),
    });
    assert(conflict.status === 409, '409');
    assert(
      errorCode(await readJson(conflict)) === 'app.err.action.idempotency_conflict',
      'conflict',
    );
    return pass(id, 'Idempotency body mismatch conflict');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv29: Run = async (ctx) => {
  const id = 'TV-29';
  try {
    const key = 'idem_tv29';
    const h = actionHeaders(ctx, {
      'X-APP-Idempotency-Key': key,
      'X-APP-If-Match-Version': 'v1',
      Cookie: 'session=tv29',
    });
    const body = JSON.stringify({ app: '1.0', action: 'slow_add', params: { amount: 1 } });
    const p1 = ctx.fetch(`${ctx.baseUrl}${tvPath(29)}`, { method: 'POST', headers: h, body });
    await new Promise((r) => setTimeout(r, 20));
    const p2 = await ctx.fetch(`${ctx.baseUrl}${tvPath(29)}`, { method: 'POST', headers: h, body });
    assert(p2.status === 409, 'in-flight conflict');
    assert(errorCode(await readJson(p2)) === 'app.err.action.conflict', 'action.conflict');
    const done = await p1;
    assert(done.status === 200, 'first completes');
    const retry = await ctx.fetch(`${ctx.baseUrl}${tvPath(29)}`, {
      method: 'POST',
      headers: { ...h, 'X-APP-If-Match-Version': 'v2' },
      body,
    });
    assert(retry.status === 200, 'retry after completion');
    return pass(id, 'In-flight idempotency conflict then success');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv30: Run = async (ctx) => {
  const id = 'TV-30';
  try {
    await ctx.fetch(`${ctx.baseUrl}${tvPath(30)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'bump', params: {} }),
    });
    const conflict = await ctx.fetch(`${ctx.baseUrl}${tvPath(30)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'bump', params: {} }),
    });
    assert(conflict.status === 409, '409');
    assert(errorCode(await readJson(conflict)) === 'app.err.diff.conflict', 'diff.conflict');
    const fresh = await ctx.fetch(`${ctx.baseUrl}${tvPath(30)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const manifest = (await readJson(fresh)) as { page: { version: string } };
    const retry = await ctx.fetch(`${ctx.baseUrl}${tvPath(30)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': manifest.page.version }),
      body: JSON.stringify({ app: '1.0', action: 'bump', params: {} }),
    });
    assert(retry.status === 200, 'retry ok');
    return pass(id, 'Stale version conflict then retry');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv31: Run = async (ctx) => {
  const id = 'TV-31';
  try {
    // Raw: advance the page (v1→v2), then a stale If-Match still 409s.
    const seed = await ctx.fetch(`${ctx.baseUrl}${tvPath(31)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'bump', params: {} }),
    });
    assert(seed.status === 200, `seed bump, got ${seed.status}`);
    const third = await ctx.fetch(`${ctx.baseUrl}${tvPath(31)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'bump', params: {} }),
    });
    assert(third.status === 409, 'still conflict');

    // Client: race_bump conflicts even after a correct rebase → conflict_persistent.
    const client = new AgentClient({ fetch: ctx.fetch });
    const m = await client.hydrate(`${ctx.baseUrl}${tvPath(31)}`);
    let code = '';
    try {
      await client.invoke(m, 'race_bump', {});
    } catch (e) {
      code = (e as { code?: string }).code ?? '';
    }
    assert(
      code === 'app.err.diff.conflict_persistent',
      `conflict_persistent, got ${code || 'no error'}`,
    );
    return pass(id, 'Rebase-then-retry conflict surfaces as conflict_persistent');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv32: Run = async (ctx) => {
  const id = 'TV-32';
  try {
    const get = await ctx.fetch(`${ctx.baseUrl}${tvPath(36)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const manifest = (await readJson(get)) as import('@agent-page/client').PageManifest;
    const result = clientApplyDiff(manifest, {
      app: '1.0',
      base: {
        version: manifest.page.version,
        page_id: manifest.page.id,
        page_url: manifest.page.url,
      },
      result_version: 'v2',
      diff: [
        { op: 'test', path: '/state/n/value', value: 999 },
        { op: 'replace', path: '/state/n/value', value: 10 },
      ],
    });
    assert(!result.ok, 'test failure discards diff');
    assert(result.code === 'app.err.diff.test_failed', result.code ?? 'code');
    return pass(id, 'Diff test op failure discards apply');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv33: Run = async (ctx) => {
  const id = 'TV-33';
  try {
    const get = await ctx.fetch(`${ctx.baseUrl}${tvPath(36)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const manifest = (await readJson(get)) as import('@agent-page/client').PageManifest;
    const result = clientApplyDiff(manifest, {
      app: '1.0',
      base: {
        version: manifest.page.version,
        page_id: manifest.page.id,
        page_url: manifest.page.url,
      },
      result_version: 'v2',
      diff: [
        { op: 'replace', path: '/state/n/value', value: 1 },
        { op: 'replace', path: '/state/missing/value', value: 1 },
        { op: 'replace', path: '/state/n/value', value: 2 },
      ],
    });
    assert(!result.ok, 'apply fails atomically');
    assert(result.code === 'app.err.diff.apply_failed', result.code ?? 'code');
    return pass(id, 'Atomic rollback on mid-diff failure');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv34: Run = async (ctx) => {
  const id = 'TV-34';
  try {
    const get = await ctx.fetch(`${ctx.baseUrl}${tvPath(36)}`, {
      headers: { Accept: ACCEPT_PAGE },
    });
    const manifest = (await readJson(get)) as import('@agent-page/client').PageManifest;
    const check = validateDiffOps(
      [{ op: 'replace', path: '/page/version', value: 'v9' }],
      manifest,
    );
    assert(!check.ok, '/page/version forbidden');
    assert(check.ok === false && check.code === 'app.err.diff.invalid_path', check.code ?? 'code');
    return pass(id, 'Client rejects /page/version patch');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv35: Run = async (ctx) => {
  const id = 'TV-35';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(35)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'replace_table', params: {} }),
    });
    assert(res.status === 200, '200');
    const diff = (await readJson(res)) as { diff: Array<{ op: string; path: string }> };
    const root = diff.diff.find(
      (d) => d.path === '/state/results' || d.path === '/state/results/value',
    );
    assert(root != null, 'whole-table replace');
    return pass(id, 'Whole-table replace via diff');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv36: Run = async (ctx) => {
  const id = 'TV-36';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(36)}`, {
      method: 'POST',
      headers: actionHeaders(ctx, { 'X-APP-If-Match-Version': 'v1' }),
      body: JSON.stringify({ app: '1.0', action: 'noop', params: {} }),
    });
    assert(res.status === 200, '200');
    const body = (await readJson(res)) as {
      diff: unknown[];
      result_version: string;
      base: { version: string };
    };
    assert(Array.isArray(body.diff) && body.diff.length === 0, 'empty diff');
    assert(
      body.result_version === body.base.version || body.result_version === 'v1',
      'no-op version',
    );
    return pass(id, 'Empty diff legal no-op');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv37: Run = async (ctx) => {
  const id = 'TV-37';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(37)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({ app: '1.0', action: 'bad_nav', params: {} }),
      redirect: 'manual',
    });
    // Server returns 200 full — client MUST treat as violation
    assert(res.status === 200, 'server returns 200 (violation fixture)');
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('vnd.agent-page+json'), 'manifest body');

    // Client: a navigate action answered with a 200 manifest → manifest.invalid.
    const client = new AgentClient({ fetch: ctx.fetch });
    const m = await client.hydrate(`${ctx.baseUrl}${tvPath(37)}`);
    let code = '';
    try {
      await client.invoke(m, 'bad_nav', {});
    } catch (e) {
      code = (e as { code?: string }).code ?? '';
    }
    assert(code === 'app.err.manifest.invalid', `manifest.invalid, got ${code || 'no error'}`);
    return pass(id, 'Navigate 200 manifest rejected client-side');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv38: Run = async (ctx) => {
  const id = 'TV-38';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(38)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({ app: '1.0', action: 'go', params: { q: 'test' } }),
      redirect: 'manual',
    });
    assert(res.status === 303, `303, got ${res.status}`);
    const loc = res.headers.get('Location');
    assert(loc != null, 'Location');
    const follow = await ctx.fetch(loc, { headers: { Accept: ACCEPT_PAGE } });
    assert(follow.status === 200, 'follow GET manifest');
    return pass(id, 'Navigate 303 + Location follow');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};

export const runTv39: Run = async (ctx) => {
  const id = 'TV-39';
  try {
    const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(39)}`, {
      method: 'POST',
      headers: actionHeaders(ctx),
      body: JSON.stringify({ app: '1.0', action: 'mismatch', params: {} }),
      redirect: 'manual',
    });
    assert(res.status === 303, `303, got ${res.status}`);
    const loc = res.headers.get('Location');
    const nav = res.headers.get('X-APP-Navigate');
    assert(loc != null && nav != null, 'both headers required');
    assert(loc !== nav, 'headers must mismatch');
    return pass(id, 'Mismatched navigate headers detected');
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : String(e));
  }
};
