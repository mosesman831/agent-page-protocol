import { describe, it, expect } from 'vitest';
import { ORDER_TRANSITIONS, type OrderStatus, type OrderValue } from '../src/types.js';
import {
  applyRefund,
  applyTransition,
  isLegalTransition,
  requireOrderValue,
} from '../src/order.js';
import { AppError } from '../src/errors.js';

function order(status: OrderStatus): OrderValue {
  return { id: 'ord_1', status, currency: 'GBP', total: 64000, scale: 2 };
}

describe('ORDER_TRANSITIONS (K3 MF-5)', () => {
  it('allows cancel_pending only to cancelled | awaiting_payment | fulfilling', () => {
    expect(ORDER_TRANSITIONS.cancel_pending).toEqual([
      'cancelled',
      'awaiting_payment',
      'fulfilling',
    ]);
    expect(isLegalTransition('cancel_pending', 'cancelled')).toBe(true);
    expect(isLegalTransition('cancel_pending', 'awaiting_payment')).toBe(true);
    expect(isLegalTransition('cancel_pending', 'fulfilling')).toBe(true);
    expect(isLegalTransition('cancel_pending', 'paid')).toBe(false);
    expect(isLegalTransition('cancel_pending', 'draft')).toBe(false);
  });

  it('rejects illegal paid -> draft', () => {
    expect(isLegalTransition('paid', 'draft')).toBe(false);
    expect(() => applyTransition(order('paid'), 'draft')).toThrow(AppError);
    try {
      applyTransition(order('paid'), 'draft');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.envelope.error.code).toBe('app.err.commerce.illegal_transition');
      expect(err.httpStatus).toBe(409);
      expect(err.envelope.error.details?.from).toMatchObject({ type: 'string', value: 'paid' });
      expect(err.envelope.error.details?.to).toMatchObject({ type: 'string', value: 'draft' });
    }
  });

  it('applies legal transitions', () => {
    const next = applyTransition(order('draft'), 'pending');
    expect(next.status).toBe('pending');
    expect(applyTransition(order('paid'), 'fulfilling').status).toBe('fulfilling');
    expect(applyTransition(order('cancel_pending'), 'cancelled').status).toBe('cancelled');
  });

  it('rejects over-refund with commerce.amount', () => {
    try {
      applyRefund(order('paid'), 65000, 0);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.envelope.error.code).toBe('app.err.commerce.amount');
      expect(err.httpStatus).toBe(400);
    }
  });

  it('allows refund within remaining capturable', () => {
    const next = applyRefund(order('paid'), 1000, 0);
    expect(next.status).toBe('refund_pending');
  });
});

describe('requireOrderValue (commerce.not_an_order)', () => {
  it('returns the value for a well-formed order node', () => {
    const node = { type: 'order', value: order('paid') };
    expect(requireOrderValue(node).id).toBe('ord_1');
  });

  it.each([
    ['non-node', 42],
    ['wrong type', { type: 'string', value: 'x' }],
    ['non-object value', { type: 'order', value: 'x' }],
    ['missing id', { type: 'order', value: { status: 'paid' } }],
    ['unknown status', { type: 'order', value: { id: 'o1', status: 'weird' } }],
  ])('throws not_an_order for %s', (_label, node) => {
    try {
      requireOrderValue(node);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).envelope.error.code).toBe('app.err.commerce.not_an_order');
    }
  });
});
