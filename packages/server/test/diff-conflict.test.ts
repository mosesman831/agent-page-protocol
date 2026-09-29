import { describe, it, expect } from 'vitest';
import { checkIfMatchVersion, bumpVersion } from '../src/version.js';
import { buildDiffDocument, applyDiffDocument } from '../src/diff.js';
import type { PageManifest } from '../src/types.js';

function baseManifest(version: string): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'demo',
      url: 'https://example.com/demo',
      title: 'Demo',
      version,
    },
    state: {
      n: { type: 'number', value: 1 },
    },
  };
}

describe('Diff conflict (page.version)', () => {
  it('detects X-APP-If-Match-Version mismatch', () => {
    const r = checkIfMatchVersion('v2', 'v1');
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
  });

  it('allows matching version', () => {
    const r = checkIfMatchVersion('v2', 'v2');
    expect(r.ok).toBe(true);
  });

  it('allows missing header unless requiresMatch → reason missing', () => {
    expect(checkIfMatchVersion('v2', null).ok).toBe(true);
    const missing = checkIfMatchVersion('v2', null, { requiresMatch: true });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('missing');
    expect(missing.conflict).toBe(false);
  });

  it('buildDiffDocument carries base.version and result_version only (no etags)', () => {
    const base = baseManifest('v1');
    base.page.etag = '"e1"';
    const next = structuredClone(base);
    next.page.version = bumpVersion(base.page.version);
    next.page.etag = '"e2"';
    (next.state.n as { value: number }).value = 2;
    const doc = buildDiffDocument(base, next);
    expect(doc.base.version).toBe('v1');
    expect(doc.result_version).toBe('v2');
    expect(doc.diff.length).toBeGreaterThan(0);
    expect((doc.base as { etag?: string }).etag).toBeUndefined();
    expect((doc as { result_etag?: string }).result_etag).toBeUndefined();
  });

  it('applyDiff rejects stale base.version', () => {
    const base = baseManifest('v1');
    const next = structuredClone(base);
    next.page.version = 'v2';
    const doc = buildDiffDocument(base, next);
    const stale = baseManifest('v0');
    const applied = applyDiffDocument(stale, doc);
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.code).toBe('app.err.diff.stale_base');
  });
});
