import { AppError, bumpVersion } from '@agent-page/server';
import type { EventBus } from '../events.js';
import type { OrderStore } from '../pages/order.js';
import type { OrderValue } from '../protocol.js';
import {
  PaymentProviderError,
  type PaymentConfig,
  type PaymentOrderRef,
  type ProviderAdapter,
} from './adapter.js';
import {
  assertCanBeginCheckout,
  commitSeamResult,
  readSeam,
  sessionMatches,
  writeSeam,
  type SeamStatus,
} from './machine.js';
import { mirrorOrder, mirrorRow } from './mirror.js';

export interface PaymentDeps {
  config: PaymentConfig;
  adapter: ProviderAdapter;
  pageOrigin: string;
  store: OrderStore;
  bus: EventBus;
}

export async function beginCheckout(deps: PaymentDeps, order: OrderValue): Promise<void> {
  const plan = assertCanBeginCheckout(order);
  if (plan === 'replay') return;

  let session: { session_id: string; checkout_url: string };
  try {
    session = await deps.adapter.createSession(toRef(order), deps.pageOrigin.replace(/\/$/, ''));
  } catch (err) {
    if (err instanceof PaymentProviderError) {
      throw new AppError('app.err.commerce.payment_failed', {
        app: '1.1',
        message: err.message.slice(0, 500),
        retryable: err.retryable,
      });
    }
    throw new AppError('app.err.commerce.payment_failed', {
      app: '1.1',
      message: 'Payment provider rejected checkout',
      retryable: false,
    });
  }

  order.extra = {
    ...(order.extra ?? {}),
    session_id: session.session_id,
    provider_ref: null,
  };
  if (order.payment) {
    order.payment.status = 'processing';
    order.payment.psp = deps.adapter.name;
  } else {
    order.payment = {
      status: 'processing',
      psp: deps.adapter.name,
      start_url: `${deps.pageOrigin}/orders/${order.id}/pay`,
    };
  }
  order.updated_at = new Date().toISOString();
  writeSeam(order, { payment_status: 'pending_payment', checkout_url: session.checkout_url });
  deps.store.set(order.id, order);
  await mirrorOrder(deps.config, mirrorRow(order, 'pending_payment'));
}

export async function applySeamEvent(
  deps: PaymentDeps,
  order: OrderValue,
  session: string,
  to: 'paid' | 'failed',
  providerRef: string | undefined,
): Promise<{ applied: boolean; payment_status: SeamStatus }> {
  if (!sessionMatches(order, session)) {
    throw new AppError('app.err.validation.param_pattern', {
      app: '1.1',
      message: 'session does not belong to this order',
      httpStatus: 400,
      retryable: false,
    });
  }
  const before = readSeam(order).payment_status;
  if (before === 'paid' || before === 'failed') {
    return { applied: false, payment_status: before };
  }
  const outcome = commitSeamResult(order, to, providerRef);
  if (outcome === 'noop') {
    return { applied: false, payment_status: readSeam(order).payment_status };
  }
  deps.store.set(order.id, order);
  const status = readSeam(order).payment_status;
  await mirrorOrder(deps.config, mirrorRow(order, status));
  publishOrderUpdated(deps, order);
  return { applied: true, payment_status: status };
}

function publishOrderUpdated(deps: PaymentDeps, order: OrderValue): void {
  deps.bus.publish('order.updated', {
    pageId: 'flight-order',
    pageUrl: `${deps.pageOrigin}/orders/${order.id}`,
    version: bumpVersion('o-1'),
    hint: 'revalidate',
    pointers: ['/state/order'],
  });
}

function toRef(order: OrderValue): PaymentOrderRef {
  const sku =
    typeof order.extra?.flight_id === 'string'
      ? order.extra.flight_id
      : (order.items?.[0]?.sku ?? order.id);
  return {
    id: order.id,
    currency: order.currency ?? 'GBP',
    total: order.total ?? 0,
    scale: order.scale ?? 2,
    sku,
  };
}

export function currentSeamStatus(order: OrderValue | undefined): SeamStatus | null {
  if (!order) return null;
  return readSeam(order).payment_status;
}
