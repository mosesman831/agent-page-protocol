import { describe, it, expect } from 'vitest';
import { ActionPolicy, policyLevelFor, requiresIdempotencyKey } from '../src/policy.js';
import {
  redactSecrets,
  stripForLlm,
  prepareForPlanner,
  redactHeaders,
  REDACTED,
} from '../src/redact.js';
import type { ActionDef, PageManifest } from '../src/types.js';

const baseManifest: PageManifest = {
  app: '1.0',
  page: { id: 'book', url: 'https://example.com/book', version: 'v1' },
  state: {
    price: { type: 'number', value: 420, unit: 'GBP', label: 'Price' },
    token: { type: 'string', value: 'sk-secret', secret: true },
  },
  present: { layout: 'form' },
  actions: {},
};

describe('ActionPolicy (§10.4)', () => {
  it('maps side_effect to L0–L4', () => {
    expect(policyLevelFor({ description: 'x', kind: 'query', side_effect: 'safe' })).toBe('L0');
    expect(policyLevelFor({ description: 'x', kind: 'mutate', side_effect: 'destructive' })).toBe(
      'L1',
    );
    expect(policyLevelFor({ description: 'x', kind: 'mutate', side_effect: 'financial' })).toBe(
      'L2',
    );
    expect(policyLevelFor({ description: 'x', kind: 'mutate', side_effect: 'identity' })).toBe(
      'L3',
    );
    expect(
      policyLevelFor({
        description: 'x',
        kind: 'mutate',
        side_effect: 'safe',
        requires_confirmation: true,
      }),
    ).toBe('L4');
  });

  it('requires approval for financial by default', () => {
    const policy = new ActionPolicy();
    const def: ActionDef = {
      description: 'pay',
      kind: 'mutate',
      side_effect: 'financial',
      confirm: { amount_path: 'price' },
    };
    const r = policy.evaluate('pay', def, {}, baseManifest);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.confirmation.level).toBe('L2');
      expect(r.confirmation.amount?.value).toBe(420);
    }
  });

  it('auto-allows safe L0', () => {
    const policy = new ActionPolicy();
    const r = policy.evaluate(
      'filter',
      { description: 'f', kind: 'query', side_effect: 'safe' },
      {},
      baseManifest,
    );
    expect(r.allowed).toBe(true);
  });

  it('requires idempotency key for financial/destructive/identity', () => {
    expect(
      requiresIdempotencyKey({ description: 'x', kind: 'mutate', side_effect: 'financial' }),
    ).toBe(true);
    expect(requiresIdempotencyKey({ description: 'x', kind: 'query', side_effect: 'safe' })).toBe(
      false,
    );
    expect(requiresIdempotencyKey({ description: 'x', kind: 'mutate', idempotent: false })).toBe(
      true,
    );
  });
});

describe('token budget hygiene (§15.7)', () => {
  it('redacts secret:true and auth headers', () => {
    const r = redactSecrets(baseManifest);
    expect((r.state.token as { value: string }).value).toBe(REDACTED);
    expect((baseManifest.state.token as { value: string }).value).toBe('sk-secret');
    expect(redactHeaders({ Authorization: 'Bearer x', Accept: 'a' }).Authorization).toBe(REDACTED);
  });

  it('strips present for LLM context', () => {
    const stripped = stripForLlm(baseManifest);
    expect('present' in stripped).toBe(false);
    expect((stripped.state.token as { value: string }).value).toBe(REDACTED);
  });

  it('summarizes long arrays in prepareForPlanner', () => {
    const m: PageManifest = {
      ...baseManifest,
      state: {
        ...baseManifest.state,
        results: {
          type: 'array',
          value: Array.from({ length: 20 }, (_, i) => ({
            type: 'string' as const,
            value: `item-${i}`,
          })),
        },
        total_results: { type: 'number', value: 20 },
      },
    };
    const prepared = prepareForPlanner(m, 3);
    expect((prepared.state.results as { value: unknown[] }).value).toHaveLength(3);
    expect('present' in prepared).toBe(false);
  });
});
