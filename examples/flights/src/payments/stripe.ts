import type { CreateSessionResult, PaymentOrderRef, ProviderAdapter } from './adapter.js';
import { parseStripeSignatureHeader, verifyParts, type VerifyReason } from './verify.js';

export class PaymentProviderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'PaymentProviderError';
    this.retryable = retryable;
  }
}

const REJECTED = 'Payment provider rejected checkout';

export function createStripeAdapter(opts: {
  secretKey: string | undefined;
  baseUrl: string;
}): ProviderAdapter {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  return {
    name: 'stripe',
    async createSession(
      order: PaymentOrderRef,
      returnBaseUrl: string,
    ): Promise<CreateSessionResult> {
      if (!opts.secretKey) {
        throw new PaymentProviderError(REJECTED, false);
      }
      const origin = returnBaseUrl.replace(/\/$/, '');
      const path = `/orders/${encodeURIComponent(order.id)}/pay/callback`;
      const successUrl = `${origin}${path}?session={CHECKOUT_SESSION_ID}&ok=1`;
      const cancelUrl = `${origin}${path}?session={CHECKOUT_SESSION_ID}&ok=0`;
      const body = formEncode([
        ['mode', 'payment'],
        ['success_url', successUrl],
        ['cancel_url', cancelUrl],
        ['client_reference_id', order.id],
        ['metadata[order_id]', order.id],
        ['line_items[0][quantity]', '1'],
        ['line_items[0][price_data][currency]', order.currency.toLowerCase()],
        ['line_items[0][price_data][unit_amount]', String(order.total)],
        ['line_items[0][price_data][product_data][name]', `Flight ${order.sku}`],
      ]);

      let response: Response;
      try {
        response = await globalThis.fetch(`${baseUrl}/v1/checkout/sessions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'AbortError' || name === 'TimeoutError') {
          throw new PaymentProviderError(REJECTED, true);
        }
        throw new PaymentProviderError(REJECTED, false);
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = undefined;
      }

      if (!response.ok) {
        const stripeMessage = stripeErrorMessage(parsed);
        throw new PaymentProviderError(
          stripeMessage
            ? `${REJECTED}: ${stripeMessage}`.slice(0, 500)
            : 'Stripe checkout session failed',
          false,
        );
      }

      const id = record(parsed)?.id;
      const url = record(parsed)?.url;
      if (typeof id !== 'string' || typeof url !== 'string') {
        throw new PaymentProviderError(REJECTED, false);
      }
      return { session_id: id, checkout_url: url };
    },
  };
}

export interface LockedPaymentEvent {
  order_id: string;
  status: 'paid' | 'failed';
  provider_ref: string;
  session_id: string;
}

export type StripeNormalizeResult =
  | { type: 'reject'; reason: VerifyReason }
  | { type: 'ignore'; orderId: string | null }
  | { type: 'event'; event: LockedPaymentEvent }
  | { type: 'invalid'; code: string; message: string };

/**
 * UNVERIFIED Stripe event paths (§10.3). HMAC key is the webhook secret as stored.
 */
export function normalizeStripeWebhook(input: {
  header: string | undefined;
  rawBody: Buffer;
  secret: string;
  nowSec: number;
}): StripeNormalizeResult {
  if (input.header === undefined) return { type: 'reject', reason: 'missing' };
  const parsedHeader = parseStripeSignatureHeader(input.header);
  if (!parsedHeader) return { type: 'reject', reason: 'malformed' };
  const verified = verifyParts(
    parsedHeader.digits,
    parsedHeader.v1,
    input.rawBody,
    input.secret,
    input.nowSec,
  );
  if (!verified.ok) return { type: 'reject', reason: verified.reason };

  let body: unknown;
  try {
    body = JSON.parse(input.rawBody.toString('utf8'));
  } catch {
    return {
      type: 'invalid',
      code: 'app.err.payload.invalid_json',
      message: 'Request body is not valid JSON',
    };
  }

  const root = record(body);
  if (!root) {
    return {
      type: 'invalid',
      code: 'app.err.payload.invalid_json',
      message: 'Request body is not valid JSON',
    };
  }
  const eventType = typeof root.type === 'string' ? root.type : '';
  const data = record(root.data);
  const object = record(data?.object);
  const orderId = readOrderId(object);

  const paid = eventType === 'checkout.session.completed' && object?.payment_status === 'paid';
  const failed =
    eventType === 'checkout.session.expired' ||
    eventType === 'checkout.session.async_payment_failed';

  if (!paid && !failed) {
    return { type: 'ignore', orderId };
  }

  const sessionId = object && typeof object.id === 'string' ? object.id : null;
  const providerRef =
    object && typeof object.payment_intent === 'string' ? object.payment_intent : sessionId;

  if (!orderId || !sessionId || !providerRef) {
    return {
      type: 'invalid',
      code: 'app.err.validation.missing_param',
      message: 'Required parameter is missing',
    };
  }
  if (
    orderId.length > 128 ||
    sessionId.length > 128 ||
    providerRef.length > 256 ||
    providerRef.length < 1
  ) {
    return {
      type: 'invalid',
      code: 'app.err.validation.param_pattern',
      message: 'Parameter value does not match the required pattern',
    };
  }

  return {
    type: 'event',
    event: {
      order_id: orderId,
      status: paid ? 'paid' : 'failed',
      provider_ref: providerRef,
      session_id: sessionId,
    },
  };
}

function readOrderId(object: Record<string, unknown> | null): string | null {
  if (!object) return null;
  const metadata = record(object.metadata);
  const fromMeta = metadata?.order_id;
  if (typeof fromMeta === 'string' && fromMeta.length >= 1) return fromMeta;
  const fromClient = object.client_reference_id;
  if (typeof fromClient === 'string' && fromClient.length >= 1) return fromClient;
  return null;
}

/** Encode values; leave bracketed Stripe keys intact so unit_amount= and currency= stay literal. */
function formEncode(pairs: Array<[string, string]>): string {
  return pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

function record(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stripeErrorMessage(value: unknown): string | null {
  const root = record(value);
  const error = record(root?.error);
  return typeof error?.message === 'string' ? error.message : null;
}
