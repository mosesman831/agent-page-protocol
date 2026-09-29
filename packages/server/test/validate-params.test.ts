import { describe, it, expect } from 'vitest';
import { validateParams } from '../src/validate-params.js';
import type { ParamDef } from '../src/types.js';

describe('1.1 param types (§9)', () => {
  it('rejects geopoint lat 91 with param_range at /params/<key>/lat', () => {
    const input: Record<string, ParamDef> = { pickup: { type: 'geopoint', required: true } };
    const r = validateParams(input, { pickup: { lat: 91, lng: 0 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('app.err.validation.param_range');
    expect(r.error.path).toBe('/params/pickup/lat');
  });

  it('rejects date_range from > to with param_range', () => {
    const input: Record<string, ParamDef> = { stay: { type: 'date_range', required: true } };
    const r = validateParams(input, { stay: { from: '2026-08-21', to: '2026-08-19' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('app.err.validation.param_range');
  });

  it('rejects naive datetime_range as param_type', () => {
    const input: Record<string, ParamDef> = { window: { type: 'datetime_range', required: true } };
    const r = validateParams(input, {
      window: { from: '2026-08-19T14:00:00', to: '2026-08-19T16:00:00Z' },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('app.err.validation.param_type');
    expect(r.error.path).toBe('/params/window/from');
  });

  it('rejects quantity unit not in list with param_unit', () => {
    const input: Record<string, ParamDef> = {
      bag: { type: 'quantity', required: true, units: ['kg', 'g'] },
    };
    const r = validateParams(input, { bag: { value: 3, unit: 'lb' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('app.err.validation.param_unit');
    expect(r.error.path).toBe('/params/bag/unit');
  });

  it('rejects money non-integer amount with param_money', () => {
    const input: Record<string, ParamDef> = { total: { type: 'money', required: true } };
    const r = validateParams(input, { total: { amount: 64.5, scale: 2, currency: 'GBP' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('app.err.validation.param_money');
    expect(r.error.path).toBe('/params/total/amount');
  });

  it('accepts valid 1.1 params', () => {
    const input: Record<string, ParamDef> = {
      pickup: { type: 'geopoint', required: true },
      stay: { type: 'date_range', required: true },
      bag: { type: 'quantity', required: true, units: ['kg'] },
      total: { type: 'money', required: true },
    };
    const r = validateParams(input, {
      pickup: { lat: 51.47, lng: -0.45 },
      stay: { from: '2026-08-19', to: '2026-08-21' },
      bag: { value: 20, unit: 'kg' },
      total: { amount: 64000, scale: 2, currency: 'GBP' },
    });
    expect(r.ok).toBe(true);
  });
});
