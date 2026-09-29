import { AppError, bumpVersion, type ActionHandler, type PageManifest } from '@agent-page/server';
import type { EventBus } from '../events.js';
import {
  type OrderStore,
  buildOrderManifest,
  parsePayPath,
  parse3dsCallbackPath,
} from './order.js';
import { type DemoSession, buildSessionStateNode } from '../sessions.js';
import { asManifest, orderStateNode, stringNode, type OrderValue } from '../protocol.js';
import { checkoutDelegate, paymentSeamNodes } from '../payments/machine.js';

export function buildPay3dsManifest(
  pageOrigin: string,
  order: OrderValue,
  session: DemoSession | undefined,
  kind: 'pay' | 'callback',
  options?: { version?: string },
): PageManifest {
  const pageUrl =
    kind === 'pay'
      ? `${pageOrigin}/orders/${order.id}/pay`
      : `${pageOrigin}/orders/${order.id}/3ds-callback`;
  const amountPath = 'order_total';
  return asManifest({
    app: '1.1',
    page: {
      id: 'pay-3ds',
      url: pageUrl,
      title: kind === 'pay' ? 'Pay for order' : 'Payment return',
      version: options?.version ?? 'p-1',
      etag: kind === 'pay' ? 'W/"pay-1"' : 'W/"pay-cb-1"',
      description: 'Same-origin 3-D Secure start; bank URL only on delegates_to',
    },
    state: {
      session: buildSessionStateNode(session),
      ...paymentSeamNodes(order),
      order: orderStateNode(order),
      order_total: {
        type: 'number',
        value: order.total ?? 0,
        unit: order.currency ?? 'GBP',
        scale: order.scale ?? 2,
        label: 'Total',
      },
      slot_bound: {
        type: 'boolean',
        value: kind === 'callback',
        label: 'PSP slot bound',
      },
    },
    actions: {
      ...(order.status === 'awaiting_payment' || order.status === 'awaiting_3ds'
        ? {
            begin_checkout: {
              description: 'Create a provider checkout session',
              kind: 'delegate' as const,
              input: {},
              output: {
                delegates_to: checkoutDelegate(order),
                delegate_protocol: 'https' as const,
                resume_url: `${pageOrigin}/orders/${order.id}/pay/callback`,
              },
              side_effect: 'financial' as const,
              requires_confirmation: true,
              idempotent: true,
              timeout_ms: 15000,
              auth: 'none' as const,
            },
          }
        : {}),
      pay_redirect: {
        description: 'Open the payment provider (human I/O)',
        kind: 'delegate',
        input: {},
        output: {
          delegates_to: 'https://psp.example/3ds',
          delegate_protocol: 'https',
          resume_url: `${pageOrigin}/orders/${order.id}/3ds-callback`,
        } as import('@agent-page/server').ActionOutput,
        side_effect: 'financial',
        requires_confirmation: true,
        idempotent: false,
        timeout_ms: 15000,
        auth: 'none',
        confirm: {
          title: 'Pay with card',
          body_template:
            'Pay {state.order_total.value} {state.order_total.unit} and complete 3-D Secure at the bank?',
          amount_path: amountPath,
        },
      },
      complete_payment: {
        description: 'Capture payment after 3-D Secure return',
        kind: 'mutate',
        input: {},
        output: { state_diff: true, navigates_to: `${pageOrigin}/orders/${order.id}` },
        side_effect: 'financial',
        requires_confirmation: true,
        idempotent: false,
        timeout_ms: 30000,
        auth: 'none',
        confirm: { amount_path: amountPath },
      },
    },
    navigation: {
      breadcrumb: [
        {
          label: 'Order',
          url: `${pageOrigin}/orders/${order.id}`,
          page_id: 'flight-order',
          rel: 'up',
        },
        { label: 'Pay', url: pageUrl, page_id: 'pay-3ds' },
      ],
    },
    present: { layout: 'form' },
  });
}

export function createPay3dsHandlers(
  pageOrigin: string,
  store: OrderStore,
  bus: EventBus,
  payments: { beginCheckout(order: OrderValue): Promise<void> },
): Record<string, ActionHandler> {
  const load = (url: string): OrderValue => {
    const path = new URL(url).pathname;
    const id = parsePayPath(path) ?? parse3dsCallbackPath(path);
    if (!id) throw new AppError('app.err.page.not_found');
    const order = store.get(id);
    if (!order) throw new AppError('app.err.page.not_found');
    return order;
  };

  return {
    begin_checkout: async ({ manifest }) => {
      const order = load(manifest.page.url);
      await payments.beginCheckout(order);
      return {
        type: 'full',
        manifest: buildPay3dsManifest(pageOrigin, order, undefined, 'pay', {
          version: bumpVersion(manifest.page.version),
        }),
      };
    },

    pay_redirect: async ({ manifest }) => {
      const order = load(manifest.page.url);
      if (order.status !== 'awaiting_payment' && order.status !== 'awaiting_3ds') {
        throw new AppError('app.err.action.unavailable', {
          message: 'Order is not awaiting payment',
        });
      }
      order.status = 'awaiting_3ds';
      if (order.payment) order.payment.status = 'requires_action';
      order.updated_at = new Date().toISOString();
      store.set(order.id, order);
      // Delegate URL is off-origin (psp.example). Demo clients that cannot
      // complete human I/O SHOULD GET the same-origin resume_url instead.
      return {
        type: 'full',
        manifest: buildPay3dsManifest(pageOrigin, order, undefined, 'pay', {
          version: bumpVersion(manifest.page.version),
        }),
      };
    },

    complete_payment: async ({ manifest }) => {
      const order = load(manifest.page.url);
      if (order.status !== 'awaiting_payment' && order.status !== 'awaiting_3ds') {
        throw new AppError('app.err.commerce.illegal_transition', {
          details: {
            from: stringNode(order.status),
            to: stringNode('paid'),
          },
        });
      }
      order.status = 'paid';
      if (order.payment) order.payment.status = 'succeeded';
      order.updated_at = new Date().toISOString();
      store.set(order.id, order);
      const version = bumpVersion('o-1');
      bus.publish('order.updated', {
        pageId: 'flight-order',
        pageUrl: `${pageOrigin}/orders/${order.id}`,
        version,
        hint: 'revalidate',
        pointers: ['/state/order'],
      });
      return {
        type: 'navigate',
        url: `${pageOrigin}/orders/${order.id}`,
        mode: 'replace',
      };
    },
  };
}

export { buildOrderManifest, parsePayPath, parse3dsCallbackPath };
