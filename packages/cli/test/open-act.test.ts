import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MEDIA_DIFF, MEDIA_PAGE, type PageManifest } from '@agent-page/client';
import { createRuntime } from '../src/core/index.js';

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

describe('open-act', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ap-cli-'));
    process.env.AGENT_PAGE_ALLOW_INSECURE_HOME = '1';
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('open returns digest; act diff returns ActResult', async () => {
    const search = page(
      { id: 'flight-search', url: 'http://localhost:3456/flights', version: 'v1' },
      {
        origin: { type: 'enum', value: 'LHR', options: ['LHR', 'LGW'] },
      },
      {
        search: {
          description: 'Search',
          kind: 'navigate',
          side_effect: 'safe',
          input: {
            origin: { type: 'enum', required: true, options: ['LHR', 'LGW'] },
            destination: { type: 'enum', required: true, options: ['DXB'] },
            date: { type: 'date', required: true },
            passengers: { type: 'number' },
          },
          output: {
            navigates_to:
              'http://localhost:3456/flights/{origin}/{destination}/{date}?pax={passengers}',
          },
        },
      },
    );

    const results = page(
      {
        id: 'flight-results',
        url: 'http://localhost:3456/flights/LHR/DXB/2026-08-15?pax=1',
        version: 'v3',
        title: 'Results',
      },
      {
        total_results: { type: 'number', value: 2 },
        results: {
          type: 'table',
          fields: { id: 'string', price: 'number' },
          value: [
            ['fl-001', 84500],
            ['fl-002', 64000],
          ],
        },
      },
      {
        filter: {
          description: 'Filter',
          kind: 'query',
          side_effect: 'safe',
          idempotent: true,
          requires_etag_match: true,
          input: { max_price: { type: 'number' } },
          output: { state_diff: true },
        },
      },
    );

    const filtered = {
      ...results,
      page: { ...results.page, version: 'v4', etag: '"v4"' },
      state: {
        ...results.state,
        total_results: { type: 'number', value: 1 },
        results: {
          type: 'table',
          fields: { id: 'string', price: 'number' },
          value: [['fl-002', 64000]],
        },
      },
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/.well-known/')) {
        return jsonResponse(
          page(
            { id: 'well-known', url, version: 'wk1' },
            {
              site_name: { type: 'string', value: 'Acme Flights' },
              capabilities: {
                type: 'array',
                value: [
                  { type: 'string', value: 'search' },
                  { type: 'string', value: 'diffs' },
                ],
              },
            },
          ),
        );
      }
      if (method === 'GET' && url.endsWith('/flights')) {
        return jsonResponse(search, { headers: { etag: '"v1"' } });
      }
      if (method === 'GET' && url.includes('/flights/LHR/')) {
        return jsonResponse(results, { headers: { etag: '"v3"' } });
      }
      if (method === 'POST') {
        return jsonResponse(
          {
            app: '1.0',
            base: {
              page_id: 'flight-results',
              page_url: 'http://localhost:3456/flights/LHR/DXB/2026-08-15?pax=1',
              version: 'v3',
            },
            result_version: 'v4',
            diff: [
              {
                op: 'replace',
                path: '/state/total_results',
                value: { type: 'number', value: 1 },
              },
              {
                op: 'replace',
                path: '/state/results',
                value: filtered.state.results,
              },
            ],
          },
          { status: 200, contentType: MEDIA_DIFF },
        );
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const rt = createRuntime({
      home,
      fetch: fetchImpl as typeof fetch,
    });

    const opened = await rt.open('http://localhost:3456/flights');
    expect(opened.ok).toBe(true);
    expect(opened.page?.id).toBe('flight-search');
    expect(opened.digest?.state.origin).toBeTruthy();
    expect(JSON.stringify(opened)).not.toContain('present');

    // navigate search via template
    const nav = await rt.act('search', {
      params: {
        origin: 'LHR',
        destination: 'DXB',
        date: '2026-08-15',
        passengers: 1,
      },
    });
    expect(nav.status).toBe('navigated');
    expect(nav.page?.id).toBe('flight-results');

    const diffed = await rt.act('filter', { params: { max_price: 70000 } });
    expect(diffed.status).toBe('ok');
    expect(diffed.act?.mode).toBe('diff');
    expect(diffed.act?.result_version).toBe('v4');
    expect((diffed.act?.state_delta?.total_results as { value?: number } | undefined)?.value).toBe(
      1,
    );
    expect(diffed.digest).toBeUndefined();
  });

  it('act 303 navigate returns destination digest', async () => {
    const search = page(
      { id: 'flight-search', url: 'http://localhost:3456/flights', version: 'v1' },
      {},
      {
        search: {
          description: 'Search',
          kind: 'navigate',
          side_effect: 'safe',
          input: { origin: { type: 'string', required: true } },
          output: { navigates_to: 'http://localhost:3456/flights/{origin}' },
        },
      },
    );
    const dest = page(
      { id: 'flight-results', url: 'http://localhost:3456/flights/LHR', version: 'v2' },
      { ok: { type: 'boolean', value: true } },
    );

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('well-known')) {
        return new Response(null, { status: 404 });
      }
      if (method === 'GET' && url.endsWith('/flights')) {
        return jsonResponse(search);
      }
      if (method === 'GET' && url.endsWith('/flights/LHR')) {
        return jsonResponse(dest);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const rt = createRuntime({ home, fetch: fetchImpl as typeof fetch });
    await rt.open('http://localhost:3456/flights');
    const res = await rt.act('search', { params: { origin: 'LHR' } });
    expect(res.status).toBe('navigated');
    expect(res.digest?.page.id).toBe('flight-results');
  });
});
