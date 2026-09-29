/**
 * Order status machine (SPEC §12.2, K3 MF-5).
 */

import { AppError, detailString } from './errors.js';
import { ORDER_TRANSITIONS, ORDER_TERMINAL, type OrderStatus, type OrderValue } from './types.js';

const ORDER_STATUS_SET = new Set<string>(Object.keys(ORDER_TRANSITIONS));

/**
 * Guard for commerce handlers reading order state from untyped manifest
 * state. A malformed order node is a server bug → 500 not_an_order (§12.2).
 */
export function requireOrderValue(node: unknown): OrderValue {
  const v =
    node && typeof node === 'object' && !Array.isArray(node)
      ? (node as { type?: unknown; value?: unknown })
      : null;
  if (!v || v.type !== 'order' || typeof v.value !== 'object' || v.value === null) {
    throw new AppError('app.err.commerce.not_an_order', {
      message: 'State node is not an order node',
    });
  }
  const ov = v.value as Record<string, unknown>;
  if (
    typeof ov.id !== 'string' ||
    ov.id.length < 1 ||
    typeof ov.status !== 'string' ||
    !ORDER_STATUS_SET.has(ov.status)
  ) {
    throw new AppError('app.err.commerce.not_an_order', {
      message: 'Order node missing id or has unknown status',
      path: '/value',
    });
  }
  return ov as unknown as OrderValue;
}

export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return (ORDER_TERMINAL as readonly string[]).includes(status);
}

/**
 * Apply a closed status transition. Illegal paid->draft etc. throw 409.
 * cancel_pending may only go to cancelled | awaiting_payment | fulfilling.
 */
export function applyTransition(order: OrderValue, to: OrderStatus): OrderValue {
  const from = order.status;
  if (!isLegalTransition(from, to)) {
    throw new AppError('app.err.commerce.illegal_transition', {
      message: `Illegal order status transition ${from} -> ${to}`,
      details: {
        from: detailString(from, 'from'),
        to: detailString(to, 'to'),
      },
    });
  }
  return {
    ...order,
    status: to,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Refund amount is integer minor units at the order scale.
 * Over-refund (amount > remaining capturable) is 400 commerce.amount.
 */
export function applyRefund(order: OrderValue, amount: number, alreadyRefunded = 0): OrderValue {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new AppError('app.err.commerce.amount', {
      message: 'Refund amount must be a non-negative integer',
      path: '/params/amount',
    });
  }
  const total = order.total ?? 0;
  const remaining = total - alreadyRefunded;
  if (amount > remaining) {
    throw new AppError('app.err.commerce.amount', {
      message: 'Refund exceeds remaining capturable amount',
      path: '/params/amount',
    });
  }
  if (amount > 0 && isLegalTransition(order.status, 'refund_pending')) {
    return applyTransition(order, 'refund_pending');
  }
  return { ...order, updated_at: new Date().toISOString() };
}

export function assertLegalTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isLegalTransition(from, to)) {
    throw new AppError('app.err.commerce.illegal_transition', {
      message: `Illegal order status transition ${from} -> ${to}`,
      details: {
        from: detailString(from, 'from'),
        to: detailString(to, 'to'),
      },
    });
  }
}
