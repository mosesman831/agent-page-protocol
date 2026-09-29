import { describe, it, expect } from 'vitest';
import { ManifestCache } from '../src/cache.js';
import type { PageManifest } from '../src/types.js';

function manifest(url: string, version = 'v1'): PageManifest {
  return {
    app: '1.0',
    page: { id: 'p', url, version, etag: '"e1"' },
    state: {},
  };
}

describe('ManifestCache (§15.2)', () => {
  it('respects default public TTL freshness', () => {
    let now = 1_000_000;
    const cache = new ManifestCache({ now: () => now, defaultPublicTtlMs: 60_000 });
    cache.set('https://example.com/a', manifest('https://example.com/a'));
    const entry = cache.get('https://example.com/a')!;
    expect(cache.stillFresh(entry)).toBe(true);
    now += 61_000;
    expect(cache.stillFresh(entry)).toBe(false);
  });

  it('private / no-store entries are never fresh', () => {
    const cache = new ManifestCache();
    cache.set('https://example.com/me', manifest('https://example.com/me'), {
      cacheControl: 'private, no-store',
    });
    const entry = cache.get('https://example.com/me')!;
    expect(entry.private).toBe(true);
    expect(cache.stillFresh(entry)).toBe(false);
  });

  it('parses max-age from Cache-Control', () => {
    let now = 0;
    const cache = new ManifestCache({ now: () => now });
    cache.set('https://example.com/c', manifest('https://example.com/c'), {
      cacheControl: 'public, max-age=10',
    });
    expect(cache.stillFresh(cache.get('https://example.com/c')!)).toBe(true);
    now = 11_000;
    expect(cache.stillFresh(cache.get('https://example.com/c')!)).toBe(false);
  });

  it('touch updates fetchedAt for 304', () => {
    let now = 1000;
    const cache = new ManifestCache({ now: () => now, defaultPublicTtlMs: 60_000 });
    cache.set('https://example.com/a', manifest('https://example.com/a'));
    now = 50_000;
    cache.touch('https://example.com/a');
    expect(cache.get('https://example.com/a')!.fetchedAt).toBe(50_000);
    expect(cache.stillFresh(cache.get('https://example.com/a')!)).toBe(true);
  });

  it('does not hydrate private entries from dump/load', () => {
    const cache = new ManifestCache();
    cache.set('https://example.com/pub', manifest('https://example.com/pub'));
    cache.set('https://example.com/priv', manifest('https://example.com/priv'), {
      cacheControl: 'private, max-age=60',
    });
    const dumped = cache.dumpPublicEntries();
    expect(dumped.every((e) => !e.entry.private)).toBe(true);
    const other = new ManifestCache();
    other.loadEntries([
      ...dumped,
      {
        url: 'https://example.com/priv',
        entry: cache.get('https://example.com/priv')!,
      },
    ]);
    expect(other.get('https://example.com/priv')).toBeUndefined();
    expect(other.get('https://example.com/pub')).toBeDefined();
  });
});
