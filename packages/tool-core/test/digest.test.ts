import { describe, expect, it } from 'vitest';
import { digest } from '../src/index.js';
import type { PageManifest } from '@agent-page/client';

function manifest(overrides: Partial<PageManifest> = {}): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'flight-search',
      url: 'http://localhost:3456/flights',
      version: 'v1',
      title: 'Search Flights',
      etag: 'W/"search-1"',
      description: 'Search for available flights',
    },
    state: {
      token: { type: 'string', value: 'sekrit', secret: true, label: 'Token' },
      fare: { type: 'number', value: 64000, unit: 'GBP', scale: 2, label: 'Fare' },
    },
    actions: {
      search: {
        description: 'Search',
        kind: 'navigate',
        side_effect: 'safe',
        auth: 'none',
        input: { q: { type: 'string' } },
        output: { navigates_to: 'http://localhost:3456/flights/x' },
      },
    },
    present: { layout: 'form', chrome: '<html/>' },
    ...overrides,
  };
}

describe('digest §5', () => {
  it('strips present', () => {
    const d = digest(manifest());
    expect(d.state).not.toHaveProperty('present');
    expect(JSON.stringify(d)).not.toContain('layout');
    expect((d as unknown as { present?: unknown }).present).toBeUndefined();
  });

  it('redacts secret:true to [REDACTED]', () => {
    const d = digest(manifest());
    expect((d.state.token as { value: string }).value).toBe('[REDACTED]');
  });

  it('table top_k=8 and truncated flag', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [`id-${i}`, i]);
    const d = digest(
      manifest({
        state: {
          results: {
            type: 'table',
            fields: { id: 'string', n: 'number' },
            value: rows,
            pagination: { cursor: null, has_more: true, total: 20 },
          },
        },
      }),
    );
    expect((d.state.results as { value: unknown[] }).value).toHaveLength(8);
    expect(d.truncated).toBe(true);
    expect(d.top_k).toBe(8);
    expect((d.state.results as { pagination: { total: number } }).pagination.total).toBe(20);
  });

  it('top_k=0 does not truncate', () => {
    const rows = Array.from({ length: 12 }, (_, i) => [i]);
    const d = digest(
      manifest({
        state: {
          results: { type: 'table', fields: { n: 'number' }, value: rows },
        },
      }),
      { topK: 0 },
    );
    expect((d.state.results as { value: unknown[] }).value).toHaveLength(12);
    expect(d.truncated).toBe(false);
  });

  it('money nodes keep integer value + scale', () => {
    const d = digest(manifest());
    const fare = d.state.fare as { type: string; value: number; scale: number; unit: string };
    expect(fare.type).toBe('number');
    expect(fare.value).toBe(64000);
    expect(Number.isInteger(fare.value)).toBe(true);
    expect(fare.scale).toBe(2);
    expect(fare.unit).toBe('GBP');
  });
});
