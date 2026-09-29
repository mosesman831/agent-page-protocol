import { describe, expect, it } from 'vitest';
import {
  allV11FlagsFalse,
  capabilitiesFromWellKnown,
  emptyFeatures,
  featuresFromWellKnown,
  normalizeAuth,
  V11_FEATURE_FLAGS,
} from '../src/index.js';

describe('capabilities D-9 / §3', () => {
  it('v0.4 server (no features) => all 1.1 flags false', () => {
    const flags = featuresFromWellKnown({
      app: '1.0',
      capabilities: ['search', 'booking'],
    });
    expect(allV11FlagsFalse(flags)).toBe(true);
    for (const k of V11_FEATURE_FLAGS) {
      expect(flags[k]).toBe(false);
    }
    expect(emptyFeatures().mfa).toBe(false);
  });

  it('flattens boolean feature nodes; unknown flags ignored', () => {
    const flags = featuresFromWellKnown({
      app: '1.1',
      state: {
        features: {
          type: 'object',
          value: {
            mfa: { type: 'boolean', value: true },
            events_sse: { type: 'boolean', value: false },
            totally_unknown_flag: { type: 'boolean', value: true },
            x_vendor: { type: 'boolean', value: true },
          },
        },
      },
    });
    expect(flags.mfa).toBe(true);
    expect(flags.events_sse).toBe(false);
    expect(flags.totally_unknown_flag).toBeUndefined();
    expect(flags.x_vendor).toBe(true);
  });

  it('unknown cap ignored (non-strings dropped, never fatal)', () => {
    const caps = capabilitiesFromWellKnown({
      capabilities: ['search', 12, null, { nope: true }, 'booking'],
    });
    expect(caps).toEqual(['search', 'booking']);
  });

  it('unknown auth treated as user', () => {
    expect(normalizeAuth('none')).toBe('none');
    expect(normalizeAuth('session')).toBe('session');
    expect(normalizeAuth('magic-link')).toBe('user');
    expect(normalizeAuth('weird')).toBe('user');
  });
});
