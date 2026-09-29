import { AppError, type StateNode } from '@agent-page/server';
import {
  ORDER_TRANSITIONS,
  enumNode,
  stringNode,
  type OrderStatus,
  type OrderValue,
} from '../protocol.js';

export type SeamStatus = 'unpaid' | 'pending_payment' | 'paid' | 'failed';

export const SEAM_STATUS_OPTIONS = ['unpaid', 'pending_payment', 'paid', 'failed'] as const;

interface SeamInternals {
  payment_status: SeamStatus;
  checkout_url: string | null;
}

const seams = new WeakMap<OrderValue, SeamInternals>();

export function readSeam(order: OrderValue): SeamInternals {
  return seams.get(order) ?? { payment_status: 'unpaid', checkout_url: null };
}

export function writeSeam(order: OrderValue, next: SeamInternals): void {
  seams.set(order, next);
}

export function sessionIdOf(order: OrderValue): string | null {
  const value = order.extra?.session_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function providerRefOf(order: OrderValue): string | null {
  if (!order.extra || !Object.prototype.hasOwnProperty.call(order.extra, 'provider_ref'))
    return null;
  const value = order.extra.provider_ref;
  return typeof value === 'string' ? value : null;
}

export function paymentSeamNodes(order: OrderValue): Record<string, StateNode> {
  const seam = readSeam(order);
  const nodes: Record<string, StateNode> = {
    payment_status: enumNode(seam.payment_status, SEAM_STATUS_OPTIONS, 'Payment'),
  };
  const sessionId = sessionIdOf(order);
  if (seam.payment_status !== 'unpaid' && sessionId) {
    nodes.payment_session = stringNode(sessionId, 'Payment session');
  }
  return nodes;
}

export function checkoutDelegate(order: OrderValue): string | null {
  const seam = readSeam(order);
  if (!sessionIdOf(order) || !seam.checkout_url) return null;
  return seam.checkout_url;
}

export function assertCanBeginCheckout(order: OrderValue): 'create' | 'replay' {
  const seam = readSeam(order);
  if (seam.payment_status === 'paid' || seam.payment_status === 'failed') {
    throw unavailable();
  }
  if (seam.payment_status === 'pending_payment') {
    if (!sessionIdOf(order) || !seam.checkout_url) throw unavailable();
    return 'replay';
  }
  if (order.status !== 'awaiting_payment' && order.status !== 'awaiting_3ds') {
    throw unavailable();
  }
  return 'create';
}

export function sessionMatches(order: OrderValue, session: string): boolean {
  return order.extra?.session_id === session;
}

/**
 * Apply paid/failed only after the caller has checked the session.
 * Terminal seam states are no-ops. Illegal order hops throw before any write.
 */
export function commitSeamResult(
  order: OrderValue,
  to: 'paid' | 'failed',
  providerRef: string | undefined,
): 'applied' | 'noop' {
  const seam = readSeam(order);
  if (seam.payment_status === 'paid' || seam.payment_status === 'failed') return 'noop';
  if (seam.payment_status !== 'pending_payment') {
    throw new AppError('app.err.validation.param_pattern', {
      app: '1.1',
      message: 'session does not belong to this order',
      httpStatus: 400,
      retryable: false,
    });
  }

  if (order.status !== to) {
    const allowed = ORDER_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(to as OrderStatus)) {
      throw new AppError('app.err.commerce.illegal_transition', {
        app: '1.1',
        details: {
          from: stringNode(order.status),
          to: stringNode(to),
        },
      });
    }
  }

  if (order.status !== to) order.status = to;
  const paymentStatus = to === 'paid' ? 'succeeded' : 'failed';
  if (order.payment) order.payment.status = paymentStatus;
  else order.payment = { status: paymentStatus };
  if (providerRef !== undefined) {
    order.extra = { ...(order.extra ?? {}), provider_ref: providerRef };
  }
  order.updated_at = new Date().toISOString();
  writeSeam(order, { payment_status: to, checkout_url: seam.checkout_url });
  return 'applied';
}

function unavailable(): AppError {
  return new AppError('app.err.action.unavailable', {
    app: '1.1',
    message: 'Order is not awaiting payment',
  });
}
