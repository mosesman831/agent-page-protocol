/**
 * Receipt checks (SPEC §5.7) + catalog coverage for codes that existed in
 * ERROR_REGISTRY but were never thrown: manifest.url_mismatch,
 * manifest.invalid_page_id, manifest.strict_unknown, state.unknown_type,
 * action.forbidden_kind, consent.unknown_purpose, events.mode.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentClient } from '../src/agent.js';
import { AppError } from '../src/errors.js';
import { ActionPolicy } from '../src/policy.js';
import { collectConsent } from '../src/consent.js';
import { subscribeEvents } from '../src/events.js';
import { MEDIA_PAGE } from '../src/media-types.js';
import type { ConsentRequest, PageManifest } from '../src/types.js';

function page(pageOverrides: Partial<PageManifest['page']> = {}): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'search',
      title: 'Search',
      url: 'https://example.com/search',
      version: 'v1',
      etag: '"v1"',
      ...pageOverrides,
    },
    state: {},
    actions: {},
  } as PageManifest;
}

function clientWith(manifest: PageManifest, init: { strict?: boolean } = {}) {
  const fetchImpl = vi.fn(async () => {
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { 'content-type': MEDIA_PAGE, etag: '"v1"' },
    });
  });
  return new AgentClient({ fetch: fetchImpl as typeof fetch, strict: init.strict });
}

describe('manifest receipt checks (§5.7)', () => {
  it('rejects a page.url that does not match the request URL', async () => {
    const client = clientWith(page({ url: 'https://evil.example/search' }));
    await expect(client.hydrate('https://example.com/search')).rejects.toMatchObject({
      code: 'app.err.manifest.url_mismatch',
    });
  });

  it('accepts page.url differing only by normalization trivia', async () => {
    const client = clientWith(page({ url: 'https://EXAMPLE.com:443/search#frag' }));
    await expect(client.hydrate('https://example.com/search')).resolves.toBeTruthy();
  });

  it('rejects page.id violating the grammar', async () => {
    const client = clientWith(page({ id: 'BAD id!' }));
    await expect(client.hydrate('https://example.com/search')).rejects.toMatchObject({
      code: 'app.err.manifest.invalid_page_id',
    });
  });

  it('allows unknown root members in production mode', async () => {
    const m = page() as PageManifest & { future_field?: unknown };
    m.future_field = { x: 1 };
    await expect(clientWith(m).hydrate('https://example.com/search')).resolves.toBeTruthy();
  });

  it('strict mode rejects unknown root members', async () => {
    const m = page() as PageManifest & { future_field?: unknown };
    m.future_field = { x: 1 };
    await expect(
      clientWith(m, { strict: true }).hydrate('https://example.com/search'),
    ).rejects.toMatchObject({ code: 'app.err.manifest.strict_unknown' });
  });

  it('strict mode rejects unknown state node types', async () => {
    const m = page();
    (m.state as Record<string, unknown>).weird = { type: 'quantum', value: 1 };
    await expect(
      clientWith(m, { strict: true }).hydrate('https://example.com/search'),
    ).rejects.toMatchObject({ code: 'app.err.state.unknown_type' });
  });

  it('production mode tolerates unknown state node types', async () => {
    const m = page();
    (m.state as Record<string, unknown>).weird = { type: 'quantum', value: 1 };
    await expect(clientWith(m).hydrate('https://example.com/search')).resolves.toBeTruthy();
  });
});

describe('cache.revalidate_failed', () => {
  it('rejects a 304 for a URL never cached', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }));
    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    await expect(client.hydrate('https://example.com/search')).rejects.toMatchObject({
      code: 'app.err.cache.revalidate_failed',
    });
  });
});

describe('diff.conflict_persistent', () => {
  it('gives up after a rebase-retry still conflicts', async () => {
    const manifest: PageManifest = {
      ...page(),
      actions: {
        do_thing: {
          description: 'mutating',
          kind: 'mutate',
          side_effect: 'safe',
          requires_etag_match: true,
          input: {},
        },
      },
    };
    const conflict = {
      app: '1.0',
      error: { code: 'app.err.diff.conflict', message: 'stale', recoverable_actions: [] },
    };
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(conflict), {
          status: 409,
          headers: { 'content-type': 'application/vnd.agent-page-error+json' },
        });
      }
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { 'content-type': MEDIA_PAGE, etag: '"v2"' },
      });
    });
    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    await expect(client.invoke(manifest, 'do_thing', {})).rejects.toMatchObject({
      code: 'app.err.diff.conflict_persistent',
    });
  });

  it('rebases and succeeds when the retry applies cleanly (§7.4)', async () => {
    const v1: PageManifest = {
      ...page(),
      actions: {
        do_thing: {
          description: 'mutating',
          kind: 'mutate',
          side_effect: 'safe',
          requires_etag_match: true,
          input: {},
        },
      },
    };
    const v2: PageManifest = {
      ...v1,
      page: { ...v1.page, version: 'v2', etag: '"v2"' },
    };
    const conflict = {
      app: '1.0',
      error: { code: 'app.err.diff.conflict', message: 'stale', recoverable_actions: [] },
    };
    let posts = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        if (posts === 1) {
          return new Response(JSON.stringify(conflict), {
            status: 409,
            headers: { 'content-type': 'application/vnd.agent-page-error+json' },
          });
        }
        return new Response(JSON.stringify(v2), {
          status: 200,
          headers: { 'content-type': MEDIA_PAGE, etag: '"v2"' },
        });
      }
      return new Response(JSON.stringify(v2), {
        status: 200,
        headers: { 'content-type': MEDIA_PAGE, etag: '"v2"' },
      });
    });
    const client = new AgentClient({ fetch: fetchImpl as typeof fetch });
    const result = await client.invoke(v1, 'do_thing', {});
    expect(posts).toBe(2);
    expect(result.manifest.page.version).toBe('v2');
  });
});

describe('action.forbidden_kind (client policy)', () => {
  it('refuses a forbidden kind outright', () => {
    const policy = new ActionPolicy({ forbiddenKinds: ['mutate'] });
    const action = {
      description: 'mutating',
      kind: 'mutate' as const,
      side_effect: 'safe' as const,
      input: {},
    };
    try {
      policy.evaluate('do_thing', action, {}, page());
      expect.unreachable('should have thrown forbidden_kind');
    } catch (e) {
      expect((e as AppError).code).toBe('app.err.action.forbidden_kind');
    }
  });
});

describe('consent.unknown_purpose (client)', () => {
  it('rejects a grant for a purpose the page never declared', async () => {
    const req: ConsentRequest = {
      version: '1.0',
      required: false,
      purposes: [{ id: 'necessary', granted: true, required: true }],
    };
    await expect(
      collectConsent(async () => ({ purposes: [{ id: 'telemetry', granted: true }] }), req),
    ).rejects.toMatchObject({ code: 'app.err.consent.unknown_purpose' });
  });
});

describe('events.mode', () => {
  it('rejects an unknown subscription mode', async () => {
    await expect(
      subscribeEvents({} as never, 'https://example.com/page', {
        eventsUrl: 'https://example.com/app-events',
        mode: 'websockets' as 'sse',
      }),
    ).rejects.toMatchObject({ code: 'app.err.events.mode' });
  });
});

describe('pagination normalization (v0.4 §5.2 invariant 9 / TV-04)', () => {
  it('treats cursor:null + has_more:true as has_more:false and warns', async () => {
    const m = page();
    m.state = {
      items: {
        type: 'array',
        label: 'Items',
        value: [],
        pagination: { cursor: null, has_more: true, total: null },
      } as PageManifest['state'][string],
    };
    const out = await clientWith(m).hydrate('https://example.com/search');
    const items = out.state.items as { pagination?: { has_more?: boolean } };
    expect(items.pagination?.has_more).toBe(false);
    const warnings = (out.meta?.warnings ?? []) as { code?: string }[];
    expect(warnings.some((w) => w.code === 'app.warn.state.pagination_inconsistent')).toBe(true);
  });
});
