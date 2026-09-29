import { describe, it, expect } from 'vitest';
import {
  applyDiff,
  applyDiffDocument,
  isAllowedDiffPath,
  isTableCellPath,
  validateDiffOps,
} from '../src/diff.js';
import { AppError } from '../src/errors.js';
import type { DiffDocument, PageManifest } from '../src/types.js';

function baseManifest(version = 'v1'): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'results',
      url: 'https://example.com/flights',
      title: 'Flights',
      version,
      etag: `"etag-${version}"`,
    },
    state: {
      total_results: { type: 'number', value: 2, label: 'Total' },
      results: {
        type: 'table',
        fields: { id: 'string', price: 'number' },
        value: [
          ['fl-1', 100],
          ['fl-2', 200],
        ],
        item_label: 'flight',
      },
      items: {
        type: 'array',
        value: [{ type: 'object', value: { id: { type: 'string', value: 'fl-1' } } }],
        item_label: 'flight',
      },
    },
    actions: {
      filter: {
        description: 'Filter',
        kind: 'query',
        side_effect: 'safe',
        idempotent: true,
        output: { state_diff: true },
        param_mode: 'strict',
        requires_etag_match: false,
      },
    },
  };
}

describe('diff apply (§7 / TV-32..TV-36)', () => {
  it('applies replace ops and sets result_version (no etag fields)', () => {
    const base = baseManifest('v1');
    const diffDoc: DiffDocument = {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [
        {
          op: 'replace',
          path: '/state/total_results',
          value: { type: 'number', value: 0, label: 'Total' },
        },
      ],
    };
    const next = applyDiff(base, diffDoc);
    expect(next.page.version).toBe('v2');
    expect((next.state.total_results as { value: number }).value).toBe(0);
    expect(base.page.version).toBe('v1');
  });

  it('rejects stale_base on version mismatch', () => {
    const base = baseManifest('v1');
    const diffDoc: DiffDocument = {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v0' },
      result_version: 'v2',
      diff: [],
    };
    const r = applyDiffDocument(base, diffDoc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('app.err.diff.stale_base');
    expect(() => applyDiff(base, diffDoc)).toThrow(AppError);
  });

  it('does not check etag equality (C2)', () => {
    const base = baseManifest('v1');
    base.page.etag = '"local"';
    const r = applyDiffDocument(base, {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects /page/version and other forbidden paths (TV-34)', () => {
    const base = baseManifest();
    expect(isAllowedDiffPath('/page/id')).toBe(false);
    expect(isAllowedDiffPath('/page/version')).toBe(false);
    expect(isAllowedDiffPath('/page/etag')).toBe(false);
    expect(isAllowedDiffPath('/app')).toBe(false);
    expect(isAllowedDiffPath('/state/x')).toBe(true);
    const r = applyDiffDocument(base, {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [{ op: 'replace', path: '/page/version', value: 'hacked' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('app.err.diff.invalid_path');
    expect(base.page.version).toBe('v1');
  });

  it('fails test op and rolls back atomically (TV-32)', () => {
    const base = baseManifest('v1');
    const r = applyDiffDocument(base, {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [
        { op: 'test', path: '/state/total_results/value', value: 999 },
        {
          op: 'replace',
          path: '/state/total_results',
          value: { type: 'number', value: 0 },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('app.err.diff.test_failed');
    expect((base.state.total_results as { value: number }).value).toBe(2);
  });

  it('rolls back when mid-apply op fails (TV-33)', () => {
    const base = baseManifest('v1');
    const r = applyDiffDocument(base, {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [
        {
          op: 'replace',
          path: '/state/total_results',
          value: { type: 'number', value: 0 },
        },
        { op: 'remove', path: '/state/does_not_exist' },
        {
          op: 'replace',
          path: '/page/title',
          value: 'should not stick',
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('app.err.diff.apply_failed');
    expect((base.state.total_results as { value: number }).value).toBe(2);
    expect(base.page.title).toBe('Flights');
    expect(base.page.version).toBe('v1');
  });

  it('allows whole-table replace; rejects cell-level patch (TV-35)', () => {
    const base = baseManifest('v1');
    expect(isTableCellPath(base, '/state/results/value/0/1')).toBe(true);
    expect(isAllowedDiffPath('/state/results/value/0/1', base)).toBe(false);

    const cell = applyDiffDocument(base, {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [{ op: 'replace', path: '/state/results/value/0/1', value: 999 }],
    });
    expect(cell.ok).toBe(false);
    if (!cell.ok) expect(cell.code).toBe('app.err.diff.invalid_path');

    const whole = applyDiffDocument(base, {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v2',
      diff: [
        {
          op: 'replace',
          path: '/state/results',
          value: {
            type: 'table',
            fields: { id: 'string', price: 'number' },
            value: [['fl-9', 50]],
          },
        },
      ],
    });
    expect(whole.ok).toBe(true);
    if (whole.ok) {
      expect((whole.manifest.state.results as { value: unknown[][] }).value).toEqual([
        ['fl-9', 50],
      ]);
      expect(whole.manifest.page.version).toBe('v2');
    }
  });

  it('empty diff MAY keep same version (TV-36)', () => {
    const base = baseManifest('v1');
    const r = applyDiffDocument(base, {
      app: '1.0',
      base: { page_id: 'results', page_url: base.page.url, version: 'v1' },
      result_version: 'v1',
      diff: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.page.version).toBe('v1');
  });

  it('rejects unsupported ops', () => {
    const bad = validateDiffOps([{ op: 'foobar', path: '/state/x', value: 1 } as never]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('app.err.diff.unsupported_op');
  });
});
