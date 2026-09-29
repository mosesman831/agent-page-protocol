import { AppError, bumpVersion, type ActionHandler, type PageManifest } from '@agent-page/server';
import { findFlightById, type FlightRecord } from '../data/flights.js';
import {
  ORDER_TRANSITIONS,
  asManifest,
  orderStateNode,
  stringNode,
  type OrderStatus,
  type OrderValue,
  type PaymentStatus,
} from '../protocol.js';
import type { EventBus } from '../events.js';
import { type DemoSession, buildSessionStateNode } from '../sessions.js';
import { paymentSeamNodes } from '../payments/machine.js';

export type OrderStore = Map<string, OrderValue>;

export function parseOrderPath(pathname: string): string | null {
  const m = /^\/orders\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return decodeURIComponent(m[1]!);
}

export function parsePayPath(pathname: string): string | null {
  const m = /^\/orders\/([^/]+)\/pay$/.exec(pathname);
  if (!m) return null;
  return decodeURIComponent(m[1]!);
}

export function parse3dsCallbackPath(pathname: string): string | null {
  const m = /^\/orders\/([^/]+)\/3ds-callback$/.exec(pathname);
  if (!m) return null;
  return decodeURIComponent(m[1]!);
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertTransition(from: OrderStatus, to: OrderStatus): void {
  const allowed = ORDER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError('app.err.commerce.illegal_transition', {
      details: {
        from: stringNode(from),
        to: stringNode(to),
      },
    });
  }
}

export function createOrderFromFlight(
  pageOrigin: string,
  flight: FlightRecord,
  orderId: string,
  status: OrderStatus = 'paid',
): OrderValue {
  const paid =
    status === 'paid' || status === 'fulfilling' || status === 'shipped' || status === 'delivered';
  const paymentStatus: PaymentStatus = paid
    ? 'succeeded'
    : status === 'awaiting_3ds'
      ? 'requires_action'
      : 'unpaid';
  return {
    id: orderId,
    status,
    currency: 'GBP',
    total: flight.price,
    scale: 2,
    items: [{ sku: flight.id, qty: 1, amount: flight.price }],
    payment: {
      status: paymentStatus,
      psp: 'demo',
      start_url: `${pageOrigin}/orders/${orderId}/pay`,
    },
    created_at: nowIso(),
    updated_at: nowIso(),
    extra: { flight_id: flight.id, flight_no: flight.flight_no },
  };
}

export function seedDemoOrders(pageOrigin: string, store: OrderStore): void {
  const fl = findFlightById('fl-002');
  if (!fl) return;
  if (!store.has('ord-demo-unpaid')) {
    store.set(
      'ord-demo-unpaid',
      createOrderFromFlight(pageOrigin, fl, 'ord-demo-unpaid', 'awaiting_payment'),
    );
  }
  if (!store.has('ord-demo-cancel')) {
    const o = createOrderFromFlight(pageOrigin, fl, 'ord-demo-cancel', 'cancel_pending');
    o.payment = {
      status: 'succeeded',
      psp: 'demo',
      start_url: `${pageOrigin}/orders/ord-demo-cancel/pay`,
    };
    store.set('ord-demo-cancel', o);
  }
}

function orderNode(order: OrderValue): import('@agent-page/server').StateNode {
  return orderStateNode(order);
}

function orderActions(pageOrigin: string, order: OrderValue): PageManifest['actions'] {
  const actions: NonNullable<PageManifest['actions']> = {};
  const st = order.status;

  if (st === 'awaiting_payment' || st === 'awaiting_3ds') {
    actions.start_pay = {
      description: 'Start payment (3-D Secure)',
      kind: 'navigate',
      input: {},
      output: { navigates_to: `${pageOrigin}/orders/${order.id}/pay` },
      side_effect: 'safe',
      idempotent: true,
      timeout_ms: 10000,
      auth: 'none',
    };
  }

  if (st === 'cancel_pending') {
    actions.resolve_cancel = {
      description: 'Resolve cancel_pending to cancelled, awaiting_payment, or fulfilling',
      kind: 'mutate',
      input: {
        to: {
          type: 'enum',
          required: true,
          options: ['cancelled', 'awaiting_payment', 'fulfilling'],
        },
      },
      output: { state_diff: true },
      side_effect: 'destructive',
      idempotent: false,
      timeout_ms: 15000,
      auth: 'session',
      requires_confirmation: true,
    };
  }

  if (
    st === 'draft' ||
    st === 'pending' ||
    st === 'awaiting_payment' ||
    st === 'paid' ||
    st === 'fulfilling'
  ) {
    actions.cancel_order = {
      description: 'Cancel this order',
      kind: 'mutate',
      input: { reason: { type: 'string', required: false, max_length: 200 } },
      output: { state_diff: true },
      side_effect: 'destructive',
      idempotent: false,
      timeout_ms: 15000,
      auth: 'session',
      requires_confirmation: true,
    };
  }

  if (st === 'paid' || st === 'fulfilling' || st === 'shipped' || st === 'delivered') {
    actions.request_refund = {
      description: 'Refund this order',
      kind: 'mutate',
      input: {
        reason: { type: 'string', required: false, max_length: 200 },
      },
      output: { state_diff: true },
      side_effect: 'financial',
      idempotent: false,
      timeout_ms: 30000,
      auth: 'session',
      requires_confirmation: true,
      confirm: { amount_path: 'order_total' },
    };
  }

  if (st === 'paid' || st === 'fulfilling') {
    actions.export_receipt = {
      description: 'Email a receipt (step-up OTP)',
      kind: 'mutate',
      input: {
        otp: {
          type: 'string',
          required: false,
          min_length: 6,
          max_length: 6,
          pattern: '^[0-9]{6}$',
        },
      },
      output: { state_diff: true },
      side_effect: 'safe',
      idempotent: true,
      timeout_ms: 15000,
      auth: 'session',
      policy: { step_up: true, secret_params: ['otp'] },
    };
  }

  return actions;
}

export function buildOrderManifest(
  pageOrigin: string,
  order: OrderValue,
  session: DemoSession | undefined,
  options?: { version?: string },
): PageManifest {
  const pageUrl = `${pageOrigin}/orders/${order.id}`;
  return asManifest({
    app: '1.1',
    page: {
      id: 'flight-order',
      url: pageUrl,
      title: `Order ${order.id}`,
      version: options?.version ?? 'o-1',
      etag: `W/"order-${order.status}"`,
      description: 'Flight order with closed status machine',
    },
    state: {
      session: buildSessionStateNode(session),
      ...paymentSeamNodes(order),
      order: orderNode(order),
      order_total: {
        type: 'number',
        value: order.total ?? 0,
        unit: order.currency ?? 'GBP',
        scale: order.scale ?? 2,
        label: 'Total',
      },
    },
    actions: orderActions(pageOrigin, order),
    navigation: {
      breadcrumb: [
        { label: 'Search', url: `${pageOrigin}/flights`, page_id: 'flight-search', rel: 'up' },
        { label: 'Order', url: pageUrl, page_id: 'flight-order' },
      ],
      related: order.payment?.start_url
        ? [
            {
              label: 'Pay',
              url: order.payment.start_url,
              page_id: 'pay-3ds',
            },
          ]
        : undefined,
    },
    present: { layout: 'detail' },
  });
}

function emitOrder(
  bus: EventBus | undefined,
  pageOrigin: string,
  order: OrderValue,
  version: string,
): void {
  bus?.publish('order.updated', {
    pageId: 'flight-order',
    pageUrl: `${pageOrigin}/orders/${order.id}`,
    version,
    hint: 'revalidate',
    pointers: ['/state/order'],
  });
}

export function createOrderHandlers(
  pageOrigin: string,
  store: OrderStore,
  bus: EventBus,
): Record<string, ActionHandler> {
  const load = (manifest: PageManifest): OrderValue => {
    const id = parseOrderPath(new URL(manifest.page.url).pathname);
    if (!id) throw new AppError('app.err.page.not_found');
    const order = store.get(id);
    if (!order) throw new AppError('app.err.page.not_found');
    return order;
  };

  return {
    start_pay: async ({ manifest }) => {
      const order = load(manifest);
      return {
        type: 'navigate',
        url: `${pageOrigin}/orders/${order.id}/pay`,
        mode: 'push',
      };
    },

    resolve_cancel: async ({ manifest, params }) => {
      const order = load(manifest);
      const to = String(params.to ?? '') as OrderStatus;
      if (to !== 'cancelled' && to !== 'awaiting_payment' && to !== 'fulfilling') {
        throw new AppError('app.err.commerce.illegal_transition', {
          details: { from: stringNode(order.status), to: stringNode(to) },
        });
      }
      if (order.status !== 'cancel_pending') {
        assertTransition(order.status, to);
      } else {
        assertTransition('cancel_pending', to);
      }
      order.status = to;
      order.updated_at = nowIso();
      if (to === 'cancelled') {
        if (order.payment) order.payment.status = 'cancelled';
      }
      if (to === 'awaiting_payment' && order.payment) {
        order.payment.status = 'unpaid';
      }
      store.set(order.id, order);
      const version = bumpVersion(manifest.page.version);
      emitOrder(bus, pageOrigin, order, version);
      return {
        type: 'diff',
        nextManifest: buildOrderManifest(pageOrigin, order, undefined, { version }),
      };
    },

    cancel_order: async ({ manifest }) => {
      const order = load(manifest);
      assertTransition(order.status, 'cancelled');
      order.status = 'cancelled';
      order.updated_at = nowIso();
      if (order.payment) order.payment.status = 'cancelled';
      store.set(order.id, order);
      const version = bumpVersion(manifest.page.version);
      emitOrder(bus, pageOrigin, order, version);
      return {
        type: 'diff',
        nextManifest: buildOrderManifest(pageOrigin, order, undefined, { version }),
      };
    },

    request_refund: async ({ manifest }) => {
      const order = load(manifest);
      assertTransition(order.status, 'refund_pending');
      order.status = 'refund_pending';
      order.updated_at = nowIso();
      store.set(order.id, order);
      const version = bumpVersion(manifest.page.version);
      emitOrder(bus, pageOrigin, order, version);
      return {
        type: 'diff',
        nextManifest: buildOrderManifest(pageOrigin, order, undefined, { version }),
      };
    },

    export_receipt: async ({ headers, params, manifest }) => {
      const challengeHeader = Array.isArray(headers['x-app-challenge'])
        ? headers['x-app-challenge'][0]
        : headers['x-app-challenge'];
      const ttlMs = 300000;
      const challengeId = 'chg_receipt_demo';
      const challengeNode = {
        type: 'object' as const,
        value: {
          id: stringNode(challengeId),
          kind: {
            type: 'enum' as const,
            value: 'otp',
            options: ['otp', 'totp', 'webauthn', 'magic_link', 'password', 'backup_code', 'push'],
          },
          channel: {
            type: 'enum' as const,
            value: 'email',
            options: [
              'sms',
              'email',
              'totp',
              'authenticator_push',
              'passkey',
              'backup_code',
              'voice',
            ],
          },
          expires_at: {
            type: 'datetime' as const,
            value: new Date(Date.now() + ttlMs).toISOString(),
          },
          ttl_ms: { type: 'number' as const, value: ttlMs },
          attempts_remaining: { type: 'number' as const, value: 3 },
          max_attempts: { type: 'number' as const, value: 5 },
          mask: stringNode('u***@example.com'),
          length: { type: 'number' as const, value: 6 },
          pattern: stringNode('^[0-9]{6}$'),
          param: stringNode('otp'),
        },
      };
      if (!challengeHeader) {
        throw new AppError('app.err.auth.challenge_required', {
          details: { challenge: challengeNode },
        });
      }
      if (challengeHeader !== challengeId) {
        throw new AppError('app.err.auth.challenge_invalid');
      }
      const otp = String(params.otp ?? '');
      if (otp !== '123456') {
        throw new AppError('app.err.auth.challenge_failed', {
          details: { challenge: challengeNode },
        });
      }
      const order = load(manifest);
      const version = bumpVersion(manifest.page.version);
      const next = buildOrderManifest(pageOrigin, order, undefined, { version });
      next.state.receipt_sent = { type: 'boolean', value: true, label: 'Receipt emailed' };
      return { type: 'diff', nextManifest: next };
    },
  };
}
