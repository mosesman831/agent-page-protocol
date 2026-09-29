/**
 * Integration tests for AgentClient — hydrate, invoke, auth, confirmation, async, navigate C4.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentClient, searchFilterBook } from '../src/agent.js';
import { AppError, ERROR_REGISTRY } from '../src/errors.js';
import { MEDIA_ACTION, MEDIA_DIFF, MEDIA_ERROR, MEDIA_PAGE } from '../src/media-types.js';
import type { DiffDocument, ErrorEnvelope, PageManifest } from '../src/types.js';

function page(
  overrides: Partial<PageManifest['page']> & { id: string; url: string; version: string },
  state: PageManifest['state'] = {},
  actions: PageManifest['actions'] = {},
): PageManifest {
  return {
    app: '1.0',
    page: {
      title: overrides.id,
      etag: `"${overrides.version}"`,
      ...overrides,
    },
    state,
    actions,
  };
}

function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) {
    headers.set('content-type', init.contentType ?? MEDIA_PAGE);
  }
  return new Response(body === null ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

describe('error registry (§9.3)', () => {
  it('includes v0.4 codes and excludes legacy partial_results', () => {
    expect(ERROR_REGISTRY['app.err.partial.results']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.partial_results']).toBeUndefined();
    expect(ERROR_REGISTRY['app.err.rate.limited']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.transport.timeout']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.action.async_failed']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.action.version_required']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.page.not_found']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.page.gone']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.state.number_precision']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.transport.method_not_allowed']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.negotiate.unsupported_media_type']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.payload.unexpected_body']).toBeTruthy();
  });
});

describe('AgentClient hydrate (§15.3)', () => {
  it('caches fresh manifests and revalidates with If-None-Match', async () => {
    let gets = 0;
    const search = page(
      { id: 'search', url: 'https://example.com/search', version: 'v1' },
      { q: { type: 'string', value: '' } },
      {
        search: {
          description: 'Search flights',
          kind: 'query',
          side_effect: 'safe',
          input: { q: { type: 'string', required: true } },
        },
      },
    );

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (init?.method === 'GET' || !init?.method) {
        gets += 1;
        if (headers.get('if-none-match') === '"v1"' && gets > 1) {
          return new Response(null, { status: 304, headers: { etag: '"v1"' } });
        }
        return jsonResponse(search, {
          headers: { etag: '"v1"', 'cache-control': 'public, max-age=60' },
        });
      }
      throw new Error(`unexpected ${init?.method} ${url}`);
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const m1 = await client.hydrate('https://example.com/search');
    expect(m1.page.id).toBe('search');
    expect(gets).toBe(1);

    const m2 = await client.hydrate('https://example.com/search');
    expect(m2.page.version).toBe('v1');
    expect(gets).toBe(1);

    const m3 = await client.hydrate('https://example.com/search', { force: true });
    expect(m3.page.version).toBe('v1');
    expect(gets).toBe(2);
  });
});

describe('AgentClient invoke + confirmation Mode A (§10.4 / TV-45)', () => {
  it('echoes 428 confirmation_challenge with identical raw body bytes', async () => {
    const bookPage = page(
      { id: 'booking', url: 'https://example.com/booking/fl-1', version: 'v3' },
      {
        price: { type: 'number', value: 50000, unit: 'GBP', scale: 2 },
        status: { type: 'string', value: 'pending' },
      },
      {
        confirm_booking: {
          description: 'Confirm and pay',
          kind: 'mutate',
          side_effect: 'financial',
          requires_confirmation: true,
          idempotent: false,
          requires_etag_match: true,
          confirm: { amount_path: 'price' },
          output: { state_diff: true },
        },
      },
    );

    let posted = 0;
    const challenge = 'conf_server_challenge_abc';
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return jsonResponse(bookPage, { headers: { etag: '"v3"' } });
      }
      posted += 1;
      const headers = new Headers(init?.headers);
      bodies.push(String(init?.body));
      expect(headers.get('content-type')).toContain(MEDIA_ACTION);
      expect(headers.get('x-app-client')).toMatch(/^agent\//);
      expect(headers.get('x-app-version')).toBe('1.1');
      expect(headers.get('x-app-accept-versions')).toBe('1.1, 1.0');
      expect(headers.get('x-app-if-match-version')).toBe('v3');
      expect(headers.get('x-app-idempotency-key')).toBeTruthy();

      if (!headers.get('x-app-confirmation')) {
        const envelope: ErrorEnvelope = {
          app: '1.0',
          error: {
            code: 'app.err.action.confirmation_required',
            message: 'Confirm payment',
            retryable: false,
            http_status: 428,
            details: {
              confirmation_challenge: { type: 'string', value: challenge },
            },
          },
        };
        return jsonResponse(envelope, { status: 428, contentType: MEDIA_ERROR });
      }

      expect(headers.get('x-app-confirmation')).toBe(challenge);
      const diff: DiffDocument = {
        app: '1.0',
        base: {
          page_id: 'booking',
          page_url: bookPage.page.url,
          version: 'v3',
        },
        result_version: 'v4',
        diff: [
          {
            op: 'replace',
            path: '/state/status',
            value: { type: 'string', value: 'confirmed' },
          },
        ],
      };
      return jsonResponse(diff, {
        contentType: MEDIA_DIFF,
        headers: { 'x-app-result-version': 'v4', 'x-app-response-mode': 'diff' },
      });
    });

    const seenChallenges: string[] = [];
    const client = new AgentClient({
      fetch: fetchImpl as typeof fetch,
      clientVersion: '0.4.0',
      onConfirm: async (req) => {
        if (req.challenge) {
          seenChallenges.push(req.challenge);
          expect(req.amount?.scale).toBe(2);
          return { approved: true, confirmationToken: req.challenge };
        }
        return true;
      },
    });

    const m = await client.hydrate(bookPage.page.url);
    const result = await client.invoke(m, 'confirm_booking', {
      passenger_name: 'Ada',
    });
    expect(result.mode).toBe('diff');
    expect((result.manifest.state.status as { value: string }).value).toBe('confirmed');
    expect(result.manifest.page.version).toBe('v4');
    expect(seenChallenges).toEqual([challenge]);
    expect(posted).toBe(2);
    // Mode A: identical raw body bytes on both POSTs
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('rejects Mode B uuid-mode for agents (TV-47)', async () => {
    const m = page(
      { id: 'p', url: 'https://example.com/p', version: 'v1' },
      {},
      {
        pay: {
          description: 'Pay',
          kind: 'mutate',
          side_effect: 'financial',
          requires_confirmation: true,
        },
      },
    );
    const client = new AgentClient({
      fetch: vi.fn(async () => jsonResponse(m)) as typeof fetch,
      onConfirm: async () => ({ approved: true, confirmationToken: 'uuid-mode:abc' }),
    });
    await expect(client.invoke(m, 'pay', {})).rejects.toMatchObject({
      code: 'app.err.action.confirmation_invalid',
    });
  });

  it('refreshes auth once on 401 then surfaces (TV-49)', async () => {
    let auth = 'old';
    let refreshCalls = 0;
    let getCount = 0;

    const okPage = page({ id: 'home', url: 'https://example.com/', version: 'v1' });

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      getCount += 1;
      if (headers.get('authorization') === 'Bearer old') {
        return jsonResponse(
          {
            app: '1.0',
            error: {
              code: 'app.err.auth.expired',
              message: 'expired',
              retryable: false,
              http_status: 401,
            },
          } satisfies ErrorEnvelope,
          { status: 401, contentType: MEDIA_ERROR },
        );
      }
      return jsonResponse(okPage);
    });

    const client = new AgentClient({
      fetch: fetchImpl as typeof fetch,
      getAuthHeaders: () => ({ Authorization: `Bearer ${auth}` }),
      onAuthRefresh: async () => {
        refreshCalls += 1;
        auth = 'new';
        return true;
      },
    });

    const m = await client.hydrate('https://example.com/');
    expect(m.page.id).toBe('home');
    expect(refreshCalls).toBe(1);
    expect(getCount).toBe(2);
  });

  it('surfaces when auth refresh still fails', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          app: '1.0',
          error: {
            code: 'app.err.auth.required',
            message: 'need auth',
            retryable: false,
            http_status: 401,
          },
        } satisfies ErrorEnvelope,
        { status: 401, contentType: MEDIA_ERROR },
      ),
    );

    const client = new AgentClient({
      fetch: fetchImpl as typeof fetch,
      getAuthHeaders: () => ({ Authorization: 'Bearer x' }),
      onAuthRefresh: async () => true,
    });

    await expect(client.hydrate('https://example.com/')).rejects.toMatchObject({
      code: 'app.err.auth.required',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('navigate Form C (C4 / TV-37..TV-39)', () => {
  it('rejects navigate 200+body as manifest.invalid (TV-37)', async () => {
    const m = page(
      { id: 'search', url: 'https://example.com/search', version: 'v1' },
      {},
      {
        go: {
          description: 'Go',
          kind: 'navigate',
          side_effect: 'safe',
          auth: 'session',
          output: { navigates_to: '/next' },
        },
      },
    );
    const dest = page({ id: 'next', url: 'https://example.com/next', version: 'v2' });

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(m);
      // Protocol violation: 200 + manifest on navigate
      return jsonResponse(dest, { status: 200 });
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const manifest = await client.hydrate(m.page.url);
    await expect(client.invoke(manifest, 'go', {})).rejects.toMatchObject({
      code: 'app.err.manifest.invalid',
    });
  });

  it('requires Location === X-APP-Navigate on 303 (TV-39)', async () => {
    const m = page(
      { id: 'search', url: 'https://example.com/search', version: 'v1' },
      {},
      {
        go: {
          description: 'Go',
          kind: 'navigate',
          side_effect: 'safe',
          auth: 'session',
        },
      },
    );

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(m);
      return new Response(null, {
        status: 303,
        headers: {
          location: 'https://example.com/a',
          'x-app-navigate': 'https://example.com/b',
          'x-app-response-mode': 'redirect',
        },
      });
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const manifest = await client.hydrate(m.page.url);
    await expect(client.invoke(manifest, 'go', {})).rejects.toMatchObject({
      code: 'app.err.manifest.invalid',
    });
  });

  it('re-GETs Location with full APP Accept after 303 (TV-38)', async () => {
    const m = page(
      { id: 'search', url: 'https://example.com/search', version: 'v1' },
      {},
      {
        go: {
          description: 'Go',
          kind: 'navigate',
          side_effect: 'safe',
          auth: 'session',
        },
      },
    );
    const dest = page({ id: 'next', url: 'https://example.com/next', version: 'v2' });
    const gets: {
      url: string;
      accept: string | null;
      version: string | null;
      client: string | null;
    }[] = [];

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if ((init?.method ?? 'GET') === 'GET') {
        gets.push({
          url,
          accept: headers.get('accept'),
          version: headers.get('x-app-version'),
          client: headers.get('x-app-client'),
        });
        if (url.includes('/next')) return jsonResponse(dest);
        return jsonResponse(m);
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: 'https://example.com/next',
          'x-app-navigate': 'https://example.com/next',
          'x-app-response-mode': 'redirect',
        },
      });
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch, clientVersion: '0.4.0' });
    const manifest = await client.hydrate(m.page.url);
    const result = await client.invoke(manifest, 'go', {});
    expect(result.manifest.page.id).toBe('next');
    const follow = gets.find((g) => g.url.includes('/next'));
    expect(follow?.accept).toContain(MEDIA_PAGE);
    expect(follow?.version).toBe('1.1');
    expect(follow?.client).toMatch(/^agent\//);
  });
});

describe('async Form D (TV-50 / TV-51)', () => {
  it('polls status_url until succeeded', async () => {
    const start = page(
      { id: 'job', url: 'https://example.com/job', version: 'v1' },
      {},
      {
        run: {
          description: 'Run',
          kind: 'mutate',
          side_effect: 'safe',
          async: true,
          idempotent: true,
        },
      },
    );

    let polls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'GET') {
        if (url.includes('/operations/op1')) {
          polls += 1;
          const state = polls < 2 ? 'running' : 'succeeded';
          return jsonResponse({
            app: '1.0',
            page: { id: 'job', url: start.page.url, version: `v${polls + 1}`, title: 'Job' },
            state: {
              operation_status: {
                type: 'object',
                value: {
                  state: {
                    type: 'enum',
                    value: state,
                    options: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
                  },
                  status_url: { type: 'string', value: 'https://example.com/operations/op1' },
                  result: { type: 'string', value: state === 'succeeded' ? 'done' : '' },
                },
              },
            },
            meta: { poll_interval_ms: 500 },
          });
        }
        return jsonResponse(start);
      }
      return jsonResponse(
        {
          app: '1.0',
          page: { id: 'job', url: start.page.url, version: 'v2', title: 'Job' },
          state: {
            operation_status: {
              type: 'object',
              value: {
                state: {
                  type: 'enum',
                  value: 'running',
                  options: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
                },
                status_url: { type: 'string', value: 'https://example.com/operations/op1' },
              },
            },
          },
          meta: { poll_interval_ms: 500 },
        },
        {
          status: 202,
          headers: { 'x-app-response-mode': 'async' },
        },
      );
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const m = await client.hydrate(start.page.url);
    const result = await client.invoke(m, 'run', {}, { asyncTimeoutMs: 10_000 });
    expect(result.mode).toBe('async');
    expect(polls).toBeGreaterThanOrEqual(2);
    const op = result.manifest.state.operation_status as {
      value: { state: { value: string } };
    };
    expect(op.value.state.value).toBe('succeeded');
  });

  it('returns soft async_failed on terminal failed (TV-51)', async () => {
    const start = page(
      { id: 'job', url: 'https://example.com/job', version: 'v1' },
      {},
      {
        run: {
          description: 'Run',
          kind: 'mutate',
          side_effect: 'safe',
          async: true,
        },
      },
    );

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'GET') {
        if (url.includes('/operations/op1')) {
          return jsonResponse({
            app: '1.0',
            page: { id: 'job', url: start.page.url, version: 'v3', title: 'Job' },
            state: {
              operation_status: {
                type: 'object',
                value: {
                  state: {
                    type: 'enum',
                    value: 'failed',
                    options: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
                  },
                  status_url: { type: 'string', value: 'https://example.com/operations/op1' },
                },
              },
            },
            error: {
              code: 'app.err.action.async_failed',
              message: 'boom',
              recoverable_actions: ['run'],
            },
            meta: { poll_interval_ms: 500 },
          });
        }
        return jsonResponse(start);
      }
      return jsonResponse(
        {
          app: '1.0',
          page: { id: 'job', url: start.page.url, version: 'v2', title: 'Job' },
          state: {
            operation_status: {
              type: 'object',
              value: {
                state: {
                  type: 'enum',
                  value: 'running',
                  options: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
                },
                status_url: { type: 'string', value: 'https://example.com/operations/op1' },
              },
            },
          },
          meta: { poll_interval_ms: 500 },
        },
        { status: 202, headers: { 'x-app-response-mode': 'async' } },
      );
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const m = await client.hydrate(start.page.url);
    const result = await client.invoke(m, 'run', {}, { asyncTimeoutMs: 10_000 });
    expect(result.manifest.error?.code).toBe('app.err.action.async_failed');
  });
});

describe('rate limit Retry-After (TV-48)', () => {
  it('waits Retry-After before retrying 429', async () => {
    const okPage = page({ id: 'home', url: 'https://example.com/', version: 'v1' });
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          {
            app: '1.0',
            error: {
              code: 'app.err.rate.limited',
              message: 'slow down',
              retryable: true,
              http_status: 429,
              retry_after_ms: 50,
            },
          } satisfies ErrorEnvelope,
          {
            status: 429,
            contentType: MEDIA_ERROR,
            headers: { 'retry-after': '0' },
          },
        );
      }
      return jsonResponse(okPage);
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const m = await client.hydrate('https://example.com/');
    expect(m.page.id).toBe('home');
    expect(calls).toBe(2);
  });
});

describe('parallel action rules (§15.6)', () => {
  it('serializes non-idempotent actions on the same page', async () => {
    const order: string[] = [];
    const m = page(
      { id: 'cart', url: 'https://example.com/cart', version: 'v1' },
      { n: { type: 'number', value: 0 } },
      {
        add: {
          description: 'Add',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          output: { state_diff: true },
        },
      },
    );

    let version = 1;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return jsonResponse({ ...m, page: { ...m.page, version: `v${version}` } });
      }
      const body = JSON.parse(String(init?.body)) as { action: string };
      order.push(`start:${body.action}`);
      await new Promise((r) => setTimeout(r, 30));
      version += 1;
      const baseVersion = `v${version - 1}`;
      const diff: DiffDocument = {
        app: '1.0',
        base: { page_id: 'cart', page_url: m.page.url, version: baseVersion },
        result_version: `v${version}`,
        diff: [
          {
            op: 'replace',
            path: '/state/n',
            value: { type: 'number', value: version - 1 },
          },
        ],
      };
      order.push(`end:${body.action}`);
      return jsonResponse(diff, { contentType: MEDIA_DIFF });
    });

    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const manifest = await client.hydrate(m.page.url);

    const p1 = client.invoke(manifest, 'add', {});
    const p2 = client.invoke({ ...manifest, page: { ...manifest.page, version: 'v1' } }, 'add', {});

    const results = await Promise.allSettled([p1, p2]);
    expect(order.filter((x) => x.startsWith('start')).length).toBeGreaterThanOrEqual(1);
    const starts = order.map((x, i) => (x.startsWith('start') ? i : -1)).filter((i) => i >= 0);
    const ends = order.map((x, i) => (x.startsWith('end') ? i : -1)).filter((i) => i >= 0);
    for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
      if (i + 1 < starts.length) {
        expect(ends[i]!).toBeLessThan(starts[i + 1]!);
      }
    }
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
  });
});

describe('search → filter → book (§15.8)', () => {
  it('runs the documented flow via searchFilterBook helper', async () => {
    const searchUrl = 'https://example.com/search';
    const resultsUrl = 'https://example.com/flights/LHR/JFK';
    const bookingUrl = 'https://example.com/booking/fl-002';

    const searchPage = page(
      { id: 'search', url: searchUrl, version: 'v1' },
      {},
      {
        search: {
          description: 'Search',
          kind: 'navigate',
          side_effect: 'safe',
          input: { from: { type: 'string' }, to: { type: 'string' } },
          output: { navigates_to: '/flights/{from}/{to}' },
        },
      },
    );

    const resultsPage = page(
      { id: 'results', url: resultsUrl, version: 'v2' },
      {
        total_results: { type: 'number', value: 2 },
        results: {
          type: 'array',
          value: [
            {
              type: 'object',
              value: { id: { type: 'string', value: 'fl-002' } },
            },
          ],
        },
      },
      {
        filter: {
          description: 'Filter',
          kind: 'query',
          side_effect: 'safe',
          idempotent: true,
          param_mode: 'lenient',
          output: { state_diff: true },
        },
        select_flight: {
          description: 'Select',
          kind: 'navigate',
          side_effect: 'safe',
          output: { navigates_to: '/booking/{flight_id}' },
        },
      },
    );

    const bookingPage = page(
      { id: 'booking', url: bookingUrl, version: 'v3' },
      {
        price: { type: 'number', value: 35000, unit: 'GBP', scale: 2 },
        status: { type: 'string', value: 'pending' },
      },
      {
        confirm_booking: {
          description: 'Pay',
          kind: 'mutate',
          side_effect: 'financial',
          requires_confirmation: true,
          confirm: { amount_path: 'price' },
          output: { state_diff: true },
        },
      },
    );

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'GET') {
        if (url === searchUrl || url === `${searchUrl}/`) return jsonResponse(searchPage);
        if (url.startsWith(resultsUrl)) return jsonResponse(resultsPage);
        if (url.startsWith(bookingUrl)) return jsonResponse(bookingPage);
        throw new Error(`GET ${url}`);
      }

      const body = JSON.parse(String(init?.body)) as {
        action: string;
        params?: Record<string, unknown>;
      };
      const headers = new Headers(init?.headers);

      if (body.action === 'search') {
        return new Response(null, {
          status: 303,
          headers: {
            location: resultsUrl,
            'x-app-navigate': resultsUrl,
          },
        });
      }

      if (body.action === 'filter') {
        const diff: DiffDocument = {
          app: '1.0',
          base: { page_id: 'results', page_url: resultsUrl, version: 'v2' },
          result_version: 'v2.1',
          diff: [
            {
              op: 'replace',
              path: '/state/total_results',
              value: { type: 'number', value: 1 },
            },
          ],
        };
        return jsonResponse(diff, { contentType: MEDIA_DIFF });
      }

      if (body.action === 'select_flight') {
        return new Response(null, {
          status: 303,
          headers: { location: bookingUrl, 'x-app-navigate': bookingUrl },
        });
      }

      if (body.action === 'confirm_booking') {
        if (!headers.get('x-app-confirmation')) {
          return jsonResponse(
            {
              app: '1.0',
              error: {
                code: 'app.err.action.confirmation_required',
                message: 'confirm',
                retryable: false,
                http_status: 428,
                details: {
                  confirmation_challenge: { type: 'string', value: 'conf_book_1' },
                },
              },
            } satisfies ErrorEnvelope,
            { status: 428, contentType: MEDIA_ERROR },
          );
        }
        const diff: DiffDocument = {
          app: '1.0',
          base: { page_id: 'booking', page_url: bookingUrl, version: 'v3' },
          result_version: 'v4',
          diff: [
            {
              op: 'replace',
              path: '/state/status',
              value: { type: 'string', value: 'confirmed' },
            },
          ],
        };
        return jsonResponse(diff, { contentType: MEDIA_DIFF });
      }

      throw new Error(`POST ${body.action}`);
    });

    const client = new AgentClient({
      fetch: fetchImpl as typeof fetch,
      onConfirm: async (req) => ({
        approved: true,
        confirmationToken: req.challenge ?? 'conf_book_1',
      }),
    });

    const final = await searchFilterBook(client, {
      searchUrl,
      searchParams: { from: 'LHR', to: 'JFK' },
      filterParams: { max_price: 700 },
      flightId: 'fl-002',
      bookingParams: { name: 'Ada Lovelace' },
    });

    expect(final.page.url).toBe(bookingUrl);
    expect((final.state.status as { value: string }).value).toBe('confirmed');
    expect(client.listActions(final).map((a) => a.id)).toContain('confirm_booking');
    expect(client.forPlanner(final).present).toBeUndefined();
  });
});

describe('action selection helpers (§15.5)', () => {
  it('lists actions including param_mode / requires_etag_match', async () => {
    const m = page(
      { id: 'p', url: 'https://example.com/p', version: 'v1' },
      {},
      {
        filter: {
          description: 'Filter results',
          kind: 'query',
          side_effect: 'safe',
          param_mode: 'lenient',
          input: { max_price: { type: 'number' } },
        },
        wipe: {
          description: 'Delete all',
          kind: 'mutate',
          side_effect: 'destructive',
          requires_etag_match: true,
        },
      },
    );
    const client = new AgentClient({
      fetch: vi.fn(async () => jsonResponse(m)) as typeof fetch,
    });
    const actions = client.listActions(m);
    expect(actions).toHaveLength(2);
    expect(actions.find((a) => a.id === 'wipe')?.side_effect).toBe('destructive');
    expect(actions.find((a) => a.id === 'filter')?.param_mode).toBe('lenient');
    expect(actions.find((a) => a.id === 'wipe')?.requires_etag_match).toBe(true);
  });

  it('applyDiff updates cache without result_etag', () => {
    const client = new AgentClient();
    const m = page(
      { id: 'p', url: 'https://example.com/p', version: 'v1' },
      {
        n: { type: 'number', value: 1 },
      },
    );
    client.cache.set(m.page.url, m);
    const next = client.applyDiff(m, {
      app: '1.0',
      base: { page_id: 'p', page_url: m.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [{ op: 'replace', path: '/state/n', value: { type: 'number', value: 9 } }],
    });
    expect(next.page.version).toBe('v2');
    expect(client.cache.get(m.page.url)?.version).toBe('v2');
  });

  it('throws AppError on unknown action', async () => {
    const m = page({ id: 'p', url: 'https://example.com/p', version: 'v1' });
    const client = new AgentClient({
      fetch: vi.fn(async () => jsonResponse(m)) as typeof fetch,
    });
    await expect(client.invoke(m, 'nope')).rejects.toBeInstanceOf(AppError);
  });
});

describe('1.1 unattended fail-closed (§6.5 / §7.3 / TV-76)', () => {
  it('fails closed with challenge_unattended when onChallenge is missing', async () => {
    const m = page(
      { id: 'login', url: 'https://example.com/login', version: 'lg-1' },
      {},
      {
        submit_credentials: {
          description: 'Sign in',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
        },
      },
    );
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(m);
      return jsonResponse(
        {
          app: '1.1',
          error: {
            code: 'app.err.auth.challenge_required',
            message: 'Enter the code',
            retryable: false,
            http_status: 428,
            details: {
              challenge: {
                type: 'object',
                value: {
                  id: { type: 'string', value: 'chg_01J8Z2abcdef12' },
                  kind: { type: 'enum', value: 'otp', options: ['otp'] },
                  param: { type: 'string', value: 'otp' },
                  ttl_ms: { type: 'number', value: 300000 },
                },
              },
            },
          },
        } satisfies ErrorEnvelope,
        { status: 428, contentType: MEDIA_ERROR },
      );
    });
    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const manifest = await client.hydrate(m.page.url);
    await expect(
      client.invoke(manifest, 'submit_credentials', { email: 'a@b.c' }),
    ).rejects.toMatchObject({
      code: 'app.err.auth.challenge_unattended',
    });
  });

  it('fails closed on hold and MUST NOT GET widget_url', async () => {
    const widget = 'https://challenges.example-cdn.net/widget/abc';
    const m = page(
      { id: 'search', url: 'https://example.com/search', version: 'v1' },
      {},
      {
        search: {
          description: 'Search',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
        },
        complete_hold: {
          description: 'Complete human verification',
          kind: 'mutate',
          side_effect: 'identity',
          auth: 'user',
        },
      },
    );
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(m);
      return jsonResponse(
        {
          app: '1.1',
          error: {
            code: 'app.err.hold.human_required',
            message: 'Complete human verification',
            retryable: true,
            http_status: 428,
            details: {
              hold: {
                type: 'object',
                value: {
                  id: { type: 'string', value: 'hold_01J8abcdefghij' },
                  kind: { type: 'enum', value: 'captcha', options: ['captcha'] },
                  verify_url: { type: 'string', value: 'https://example.com/holds/hold_01J8' },
                  widget_url: { type: 'string', value: widget },
                  ttl_ms: { type: 'number', value: 300000 },
                  agent_solvable: { type: 'boolean', value: false },
                },
              },
            },
          },
        } satisfies ErrorEnvelope,
        { status: 428, contentType: MEDIA_ERROR },
      );
    });
    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const manifest = await client.hydrate(m.page.url);
    await expect(client.invoke(manifest, 'search', { q: 'LHR' })).rejects.toMatchObject({
      code: 'app.err.hold.unattended',
    });
    expect(urls.some((u) => u.includes('challenges.example-cdn.net'))).toBe(false);
    await expect(client.invoke(manifest, 'complete_hold', {})).rejects.toMatchObject({
      code: 'app.err.hold.invalid',
    });
  });

  it('fails closed on delegate without onDelegate and does not GET the IdP', async () => {
    const idp = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';
    const m = page(
      { id: 'login', url: 'https://example.com/login', version: 'lg-1' },
      {},
      {
        start_google: {
          description: 'Continue with Google',
          kind: 'delegate',
          side_effect: 'identity',
          output: { delegates_to: idp, delegate_protocol: 'https' },
        },
      },
    );
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(m);
      throw new Error('POST should not run for unattended delegate');
    });
    const client = new AgentClient({
      fetch: fetchImpl as typeof fetch,
      onConfirm: async () => true,
    });
    const manifest = await client.hydrate(m.page.url);
    await expect(client.invoke(manifest, 'start_google', {})).rejects.toMatchObject({
      code: 'app.err.auth.delegate_unattended',
    });
    expect(urls.some((u) => u.includes('accounts.google.com'))).toBe(false);
  });
});
