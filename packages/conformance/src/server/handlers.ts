/**
 * Action handlers for conformance fixtures (TV-01..TV-60).
 * 1.1 identity/hold/consent/commerce/events fixtures live in ./v11.ts.
 */

import {
  AppError,
  bumpVersion,
  buildErrorEnvelope,
  type ActionHandler,
  type ActionResult,
} from '@agent-page/server';
import { expandUrlTemplate } from '../vectors/helpers.js';
import type { ConformanceState } from './state.js';
import { PAGE_HOST, tvRoute } from './fixtures.js';

export function buildHandlers(
  state: ConformanceState,
  port: number,
): Record<string, ActionHandler> {
  const originBase = `http://${PAGE_HOST}:${port}`;

  const bump: ActionHandler = async ({ manifest }) => {
    const path = tvRoute(30);
    const next = structuredClone(manifest);
    (next.state.n as { value: number }).value += 1;
    next.page.version = bumpVersion(manifest.page.version);
    next.page.etag = `"etag-${next.page.version}"`;
    state.pages.set(path, next);
    state.pages.set(tvRoute(31), structuredClone(next));
    return { type: 'diff', nextManifest: next };
  };

  const set_n: ActionHandler = async ({ manifest, params }) => {
    const next = structuredClone(manifest);
    (next.state.n as { value: number }).value = Number(params.n);
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(22), next);
    return { type: 'diff', nextManifest: next };
  };

  const need_x: ActionHandler = async ({ manifest, params }) => {
    const next = structuredClone(manifest);
    next.state.x = { type: 'string', value: String(params.x), label: 'X' };
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(23), next);
    return { type: 'diff', nextManifest: next };
  };

  const touchStrict: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.n as { value: number }).value += 1;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(24), next);
    return { type: 'diff', nextManifest: next };
  };

  const touchLenient: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.n as { value: number }).value += 1;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(25), next);
    return { type: 'diff', nextManifest: next };
  };

  const touch44: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.n as { value: number }).value += 1;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(44), next);
    state.pages.set('/vectors/csrf', next);
    return { type: 'diff', nextManifest: next };
  };

  const charge: ActionHandler = async ({ manifest, params }) => {
    const next = structuredClone(manifest);
    (next.state.bal as { value: number }).value -= Number(params.amount);
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(26), next);
    return { type: 'diff', nextManifest: next };
  };

  const add: ActionHandler = async ({ manifest, params }) => {
    const next = structuredClone(manifest);
    (next.state.total as { value: number }).value += Number(params.amount);
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(27), next);
    state.pages.set(tvRoute(28), next);
    state.pages.set('/vectors/idempotency', next);
    return { type: 'diff', nextManifest: next };
  };

  const slow_add: ActionHandler = async ({ manifest, params, sessionId }) => {
    const key = sessionId ?? 'anon';
    const inflight = state.inflightIdempotency.get(key);
    if (inflight) {
      throw new AppError('app.err.action.conflict', {
        message: 'Action already in flight',
        retryable: true,
      });
    }
    state.inflightIdempotency.set(key, true);
    await new Promise((r) => setTimeout(r, 200));
    try {
      const next = structuredClone(manifest);
      (next.state.total as { value: number }).value += Number(params.amount);
      next.page.version = bumpVersion(manifest.page.version);
      state.pages.set(tvRoute(29), next);
      return { type: 'diff', nextManifest: next };
    } finally {
      state.inflightIdempotency.delete(key);
    }
  };

  const replace_table: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    next.state.results = {
      type: 'table',
      label: 'Results',
      fields: { id: 'string', score: 'number' },
      value: [['c', 3]],
    };
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(35), next);
    return { type: 'diff', nextManifest: next };
  };

  const noop36: ActionHandler = async ({ manifest }) => ({
    type: 'diff',
    nextManifest: structuredClone(manifest),
  });

  const bad_nav: ActionHandler = async ({ manifest }) => ({
    type: 'full',
    manifest: {
      ...structuredClone(manifest),
      page: { ...manifest.page, title: 'Should not be navigate 200' },
    },
  });

  const go38: ActionHandler = async ({ params }) => {
    const url = expandUrlTemplate(`${originBase}${tvRoute(38)}/dest?q={q}`, params);
    const dest = structuredClone(state.pages.get(`${tvRoute(38)}/dest`)!);
    dest.state.q = { type: 'string', value: String(params.q), label: 'Q' };
    state.pages.set(`${tvRoute(38)}/dest`, dest);
    return { type: 'navigate', url, mode: 'push' };
  };

  const mismatch39: ActionHandler = async () => {
    state.navigateMismatch = true;
    return { type: 'navigate', url: `${originBase}${tvRoute(39)}/a`, mode: 'push' };
  };

  const search40: ActionHandler = async ({ params }) => {
    const url = expandUrlTemplate(`${originBase}${tvRoute(40)}/r?city={city}`, params);
    return { type: 'navigate', url, mode: 'push' };
  };

  const confirm_pay: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.status as { value: string }).value = 'confirmed';
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(45), next);
    state.pages.set('/vectors/financial-confirm', next);
    return { type: 'diff', nextManifest: next };
  };

  const pay: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.paid as { value: boolean }).value = true;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(46), next);
    state.pages.set('/vectors/confirmation-replay', next);
    return { type: 'diff', nextManifest: next };
  };

  const sensitive: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.n as { value: number }).value += 1;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(47), next);
    return { type: 'diff', nextManifest: next };
  };

  const ping: ActionHandler = async ({ manifest, sessionId }) => {
    const key = sessionId ?? 'anon';
    const WINDOW_MS = 2000;
    const now = Date.now();
    let rec = state.rateHits.get(key);
    if (rec && now - rec.windowStart >= WINDOW_MS) rec = undefined; // window reset
    const hits = (rec?.count ?? 0) + 1;
    state.rateHits.set(key, { count: hits, windowStart: rec?.windowStart ?? now });
    if (hits > 1) {
      const wait = Math.max(0, rec!.windowStart + WINDOW_MS - now);
      throw new AppError('app.err.rate.limited', {
        message: 'Rate limit exceeded',
        retry_after_ms: wait > 0 ? wait : WINDOW_MS,
        retryable: true,
      });
    }
    const next = structuredClone(manifest);
    (next.state.hits as { value: number }).value = hits;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(48), next);
    state.pages.set('/vectors/rate-limit', next);
    return { type: 'diff', nextManifest: next };
  };

  const refresh: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(49), next);
    state.pages.set('/vectors/auth', next);
    return { type: 'diff', nextManifest: next };
  };

  const run_job: ActionHandler = async ({ manifest }) => {
    const jobId = `job_${Date.now()}`;
    state.asyncJobs.set(jobId, {
      status: 'pending',
      pollIntervalMs: 100,
      manifest,
      terminal: 'succeeded',
    });
    return {
      type: 'async',
      jobId,
      pollIntervalMs: 100,
    };
  };

  const fail_job: ActionHandler = async ({ manifest }) => {
    const jobId = `job_fail_${Date.now()}`;
    state.asyncJobs.set(jobId, {
      status: 'pending',
      pollIntervalMs: 100,
      manifest,
      terminal: 'failed',
    });
    return {
      type: 'async',
      jobId,
      pollIntervalMs: 100,
    };
  };

  const inc: ActionHandler = async ({ manifest, params }) => {
    const next = structuredClone(manifest);
    (next.state.counter as { value: number }).value += Number(params.delta);
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(60), next);
    return { type: 'diff', nextManifest: next };
  };

  const mutate142: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.counter as { value: number }).value += 1;
    const geo = next.state.geo as { value: { lat: number; lng: number } };
    geo.value.lat += 0.01;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(142), next);
    return { type: 'diff', nextManifest: next };
  };

  const noop19: ActionHandler = async ({ manifest }): Promise<ActionResult> => ({
    type: 'full',
    manifest: structuredClone(manifest),
  });

  const explode: ActionHandler = async () => {
    throw new Error('handler exploded');
  };

  const geo_pin: ActionHandler = async ({ manifest }): Promise<ActionResult> => ({
    type: 'full',
    manifest: structuredClone(manifest),
  });

  const retry_search: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    delete next.error;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set('/vectors/soft-error', next);
    return { type: 'diff', nextManifest: next };
  };

  // TV-31: a permanently racing writer — bumps the stored page then conflicts,
  // so even a perfectly-rebased retry hits 409 (client → diff.conflict_persistent).
  const race_bump: ActionHandler = async ({ manifest }) => {
    const next = structuredClone(manifest);
    (next.state.n as { value: number }).value += 1;
    next.page.version = bumpVersion(manifest.page.version);
    state.pages.set(tvRoute(31), next);
    throw new AppError('app.err.diff.conflict', {
      message: 'Concurrent write raced this action',
      retryable: true,
    });
  };

  return {
    bump,
    race_bump,
    set_n,
    need_x,
    touch: touch44,
    touch_strict: touchStrict,
    touch_lenient: touchLenient,
    charge,
    add,
    slow_add,
    replace_table,
    noop: noop36,
    noop19,
    explode,
    geo_pin,
    bad_nav,
    go: go38,
    mismatch: mismatch39,
    search: search40,
    confirm_pay,
    confirm_booking: confirm_pay,
    pay,
    sensitive,
    ping,
    refresh,
    refresh_balance: refresh,
    run_job,
    fail_job,
    inc,
    mutate142,
    retry_search,
  };
}

export function buildVersionRequiredEnvelope(requestId: string) {
  return buildErrorEnvelope('app.err.action.version_required', {
    message: 'X-APP-If-Match-Version required',
    httpStatus: 428,
    request_id: requestId,
  });
}
