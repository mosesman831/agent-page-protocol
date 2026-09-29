import { describe, it, expect } from 'vitest';
import { validateStateNode, validateStateRoot } from '../src/validate-state.js';
import type { TableStateNode } from '../src/types.js';
import { paginateTable } from '../src/pagination.js';

describe('State validation including table', () => {
  it('accepts empty state root', () => {
    expect(validateStateRoot({})).toBeNull();
  });

  it('rejects null state', () => {
    const err = validateStateRoot(null);
    expect(err?.code).toBe('app.err.manifest.invalid');
  });

  it('validates string/number/boolean/null', () => {
    expect(validateStateNode({ type: 'string', value: 'hi' })).toBeNull();
    expect(validateStateNode({ type: 'number', value: 1.5 })).toBeNull();
    expect(validateStateNode({ type: 'boolean', value: false })).toBeNull();
    expect(validateStateNode({ type: 'null' })).toBeNull();
    expect(validateStateNode({ type: 'null', value: null })?.code).toBe(
      'app.err.state.invalid_node',
    );
  });

  it('rejects invalid dates', () => {
    expect(validateStateNode({ type: 'date', value: '2026-02-30' })?.code).toBe(
      'app.err.state.invalid_date',
    );
  });

  it('rejects illegal keys', () => {
    expect(validateStateRoot({ FromAirport: { type: 'string', value: 'x' } })?.code).toBe(
      'app.err.state.illegal_key',
    );
  });

  it('rejects depth > 32', () => {
    let node: Record<string, unknown> = { type: 'string', value: 'leaf' };
    for (let i = 0; i < 33; i++) {
      node = { type: 'object', value: { child: node } };
    }
    expect(validateStateNode(node)?.code).toBe('app.err.state.depth_exceeded');
  });

  it('validates table nodes', () => {
    const table: TableStateNode = {
      type: 'table',
      fields: { id: 'string', price: 'number', refundable: 'boolean' },
      value: [
        ['fl-1', 100, true],
        ['fl-2', 200, false],
      ],
      label: 'Flights',
      pagination: { cursor: null, has_more: false, total: 2 },
    };
    expect(validateStateNode(table)).toBeNull();
  });

  it('rejects table row length mismatch', () => {
    const err = validateStateNode({
      type: 'table',
      fields: { id: 'string', price: 'number' },
      value: [['fl-1']],
    });
    expect(err?.code).toBe('app.err.state.invalid_node');
  });

  it('rejects table cell type mismatch', () => {
    const err = validateStateNode({
      type: 'table',
      fields: { id: 'string', price: 'number' },
      value: [['fl-1', 'not-a-number']],
    });
    expect(err?.code).toBe('app.err.state.invalid_node');
  });

  it('paginates tables', () => {
    const table: TableStateNode = {
      type: 'table',
      fields: { id: 'string' },
      value: [['a'], ['b'], ['c'], ['d']],
    };
    const page = paginateTable(table, { limit: 2 });
    expect(page.value).toEqual([['a'], ['b']]);
    expect(page.pagination?.has_more).toBe(true);
    expect(page.pagination?.total).toBe(4);
    expect(page.pagination?.cursor).toBeTruthy();
  });

  it('rejects integers beyond MAX_SAFE_INTEGER (C7)', () => {
    expect(
      validateStateNode({ type: 'number', value: Number.MAX_SAFE_INTEGER })?.code,
    ).toBeUndefined();
    // 2^53 is not safely representable as distinct integer in JS number, but
    // values that are integers with |v| > MAX_SAFE_INTEGER must fail.
    // Construct via Number that is still integer-typed beyond the cap:
    const unsafe = Number.MAX_SAFE_INTEGER + 2; // rounds to 2**53 in JS
    // Use a value that remains an integer beyond the cap when represented:
    // Number.MAX_SAFE_INTEGER + 2 may equal +1 due to rounding; test the guard directly
    // with Object.defineProperty isn't needed — Math.abs(2**53) === 9007199254740992
    // and Number.isInteger(2**53) is true, and 2**53 > MAX_SAFE_INTEGER.
    expect(validateStateNode({ type: 'number', value: 2 ** 53 })?.code).toBe(
      'app.err.state.number_precision',
    );
    expect(validateStateNode({ type: 'number', value: -(2 ** 53) })?.code).toBe(
      'app.err.state.number_precision',
    );
    void unsafe;
  });

  it('requires integer value when scale is present (money)', () => {
    expect(validateStateNode({ type: 'number', value: 64000, scale: 2, unit: 'GBP' })).toBeNull();
    expect(validateStateNode({ type: 'number', value: 640.5, scale: 2, unit: 'GBP' })?.code).toBe(
      'app.err.state.invalid_node',
    );
  });

  it('rejects unknown types in strict mode', () => {
    expect(validateStateNode({ type: 'widget', value: 1 }, 0, true)?.code).toBe(
      'app.err.state.unknown_type',
    );
    expect(validateStateNode({ type: 'widget', value: 1 }, 0, false)).toBeNull();
  });

  it('validates geopoint lat/lng ranges', () => {
    expect(validateStateNode({ type: 'geopoint', value: { lat: 51.47, lng: -0.45 } })).toBeNull();
    expect(validateStateNode({ type: 'geopoint', value: { lat: 91, lng: 0 } })?.code).toBe(
      'app.err.state.invalid_geopoint',
    );
  });

  it('validates quantity, order machine shape, and ranges', () => {
    expect(validateStateNode({ type: 'quantity', value: { value: 3.5, unit: 'kg' } })).toBeNull();
    expect(
      validateStateNode({
        type: 'order',
        value: { id: 'ord_1', status: 'paid', currency: 'GBP', total: 64000, scale: 2 },
      }),
    ).toBeNull();
    expect(
      validateStateNode({ type: 'order', value: { id: 'ord_1', status: 'not_a_status' } })?.code,
    ).toBe('app.err.state.invalid_node');
    expect(
      validateStateNode({ type: 'daterange', value: { from: '2026-08-19', to: '2026-08-21' } }),
    ).toBeNull();
    expect(
      validateStateNode({ type: 'daterange', value: { from: '2026-08-21', to: '2026-08-19' } })
        ?.code,
    ).toBe('app.err.state.invalid_range');
    expect(
      validateStateNode({
        type: 'datetimerange',
        value: { from: '2026-08-19T14:00:00.000Z', to: '2026-08-19T16:00:00.000Z' },
      }),
    ).toBeNull();
    expect(
      validateStateNode({
        type: 'datetimerange',
        value: { from: '2026-08-19T14:00:00', to: '2026-08-19T16:00:00Z' },
      })?.code,
    ).toBe('app.err.state.invalid_datetime');
  });

  it('rejects 1.1 types when selectedVersion is 1.0', () => {
    expect(
      validateStateNode({ type: 'geopoint', value: { lat: 1, lng: 2 } }, 0, true, '/state', '1.0')
        ?.code,
    ).toBe('app.err.state.unknown_type');
    expect(
      validateStateRoot(
        { pickup: { type: 'geopoint', value: { lat: 1, lng: 2 } } },
        { selectedVersion: '1.0' },
      )?.code,
    ).toBe('app.err.state.unknown_type');
  });
});
