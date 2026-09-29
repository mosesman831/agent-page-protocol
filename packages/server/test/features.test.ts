import { describe, it, expect } from 'vitest';
import { parseFeatureFlags, validateFeatureImplications } from '../src/features.js';

describe('feature implication rules (§3.2)', () => {
  it('defaults missing flags to false', () => {
    const flags = parseFeatureFlags(undefined);
    expect(flags.events_sse).toBe(false);
    expect(flags.commerce).toBe(false);
    expect(flags.identity_flows).toBe(false);
  });

  it('parses boolean StateNodes', () => {
    const flags = parseFeatureFlags({
      type: 'object',
      value: {
        events_sse: { type: 'boolean', value: true },
        events_longpoll: { type: 'boolean', value: true },
        order_state: { type: 'boolean', value: true },
        commerce: { type: 'boolean', value: true },
      },
    });
    expect(flags.events_sse).toBe(true);
    expect(flags.events_longpoll).toBe(true);
    expect(flags.order_state).toBe(true);
    expect(flags.commerce).toBe(true);
  });

  it('requires events_longpoll when events_sse or events_ws is true', () => {
    const sse = parseFeatureFlags({
      type: 'object',
      value: { events_sse: { type: 'boolean', value: true } },
    });
    const r1 = validateFeatureImplications(sse);
    expect(r1.ok).toBe(false);
    expect(r1.errors[0]?.message).toMatch(/events_longpoll/);

    const ws = parseFeatureFlags({
      type: 'object',
      value: { events_ws: { type: 'boolean', value: true } },
    });
    expect(validateFeatureImplications(ws).ok).toBe(false);

    const ok = parseFeatureFlags({
      type: 'object',
      value: {
        events_sse: { type: 'boolean', value: true },
        events_longpoll: { type: 'boolean', value: true },
      },
    });
    expect(validateFeatureImplications(ok).ok).toBe(true);
  });

  it('requires commerce when order_state is true', () => {
    const flags = parseFeatureFlags({
      type: 'object',
      value: { order_state: { type: 'boolean', value: true } },
    });
    const r = validateFeatureImplications(flags);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toMatch(/commerce/);
  });

  it('warns when mfa is true without identity_flows (SHOULD)', () => {
    const flags = parseFeatureFlags({
      type: 'object',
      value: { mfa: { type: 'boolean', value: true } },
    });
    const r = validateFeatureImplications(flags);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('identity_flows'))).toBe(true);
  });
});
