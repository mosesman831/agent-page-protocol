import { describe, it, expect, vi } from 'vitest';
import { AgentClient } from '../src/agent.js';
import { shouldSendTypeahead } from '../src/typeahead.js';
import { MEDIA_ACTION, MEDIA_DIFF, MEDIA_PAGE } from '../src/media-types.js';
import type { DiffDocument, PageManifest } from '../src/types.js';

function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) headers.set('content-type', init.contentType ?? MEDIA_PAGE);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

const searchPage: PageManifest = {
  app: '1.1',
  page: { id: 'search', url: 'https://example.com/flights', version: 'v3' },
  state: {
    features: {
      type: 'object',
      value: { typeahead: { type: 'boolean', value: true } },
    },
    suggestions: { type: 'array', value: [] },
  },
  actions: {
    search: {
      description: 'Search flights',
      kind: 'query',
      side_effect: 'safe',
      input: {
        from: {
          type: 'string',
          options_source: {
            action: 'search_airports',
            param: 'q',
            results_path: 'suggestions',
            min_query_length: 2,
            debounce_ms: 40,
          },
        },
      },
    },
    search_airports: {
      description: 'Airport typeahead',
      kind: 'query',
      side_effect: 'safe',
      idempotent: true,
      input: { q: { type: 'string', required: true } },
      output: { state_diff: true },
    },
  },
};

describe('typeahead (§10)', () => {
  it('MUST NOT send if query is shorter than min_query_length', async () => {
    expect(shouldSendTypeahead('L', 2)).toBe(false);
    expect(shouldSendTypeahead('LH', 2)).toBe(true);

    const posts: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(searchPage);
      posts.push(String(init?.body));
      throw new Error('typeahead POST must not fire for short query');
    });
    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const m = await client.hydrate(searchPage.page.url);
    const result = await client.typeahead(m, 'search', 'from', 'L');
    expect(result.sent).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it('debounces before POSTing the options_source action', async () => {
    vi.useFakeTimers();
    const posts: Array<{ action: string; q: unknown; at: number }> = [];
    const start = Date.now();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(searchPage);
      const body = JSON.parse(String(init?.body)) as { action: string; params?: { q?: string } };
      expect(new Headers(init?.headers).get('content-type')).toContain(MEDIA_ACTION);
      posts.push({ action: body.action, q: body.params?.q, at: Date.now() - start });
      const diff: DiffDocument = {
        app: '1.1',
        base: { page_id: 'search', page_url: searchPage.page.url, version: 'v3' },
        result_version: 'v3',
        diff: [
          {
            op: 'replace',
            path: '/state/suggestions',
            value: {
              type: 'array',
              value: [{ type: 'string', value: 'LHR' }],
            },
          },
        ],
      };
      return jsonResponse(diff, { contentType: MEDIA_DIFF });
    });
    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const m = await client.hydrate(searchPage.page.url);
    const pending = client.typeahead(m, 'search', 'from', 'LH');
    expect(posts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(39);
    expect(posts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5);
    const result = await pending;
    expect(result.sent).toBe(true);
    expect(posts).toEqual([{ action: 'search_airports', q: 'LH', at: expect.any(Number) }]);
    vi.useRealTimers();
  });
});
