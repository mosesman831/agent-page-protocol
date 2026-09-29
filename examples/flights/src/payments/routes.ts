import { AppError, MEDIA_ERROR, MEDIA_PAGE, buildErrorEnvelope } from '@agent-page/server';
import express, { type Express, type Request, type Response } from 'express';
import { buildOrderManifest } from '../pages/order.js';
import { applySeamEvent, currentSeamStatus, type PaymentDeps } from './checkout.js';
import type { SeamStatus } from './machine.js';
import { normalizeStripeWebhook, type LockedPaymentEvent } from './stripe.js';
import { verifyPaymentSignature, type VerifyReason } from './verify.js';

const LOCKED_KEYS = ['order_id', 'status', 'provider_ref', 'session_id'] as const;

export function mountPaymentRoutes(app: Express, deps: PaymentDeps): void {
  app.get('/orders/:orderId/pay/callback', (req, res) => {
    void handleCallback(req, res, deps);
  });
  app.post('/webhooks/payment', express.raw({ type: () => true, limit: '64kb' }), (req, res) => {
    void handleWebhook(req, res, deps);
  });
}

async function handleCallback(req: Request, res: Response, deps: PaymentDeps): Promise<void> {
  try {
    const id = decodeURIComponent(String(req.params.orderId ?? ''));
    const order = deps.store.get(id);
    if (!order) {
      sendError(res, 'app.err.page.not_found', 'Page not found', 404);
      return;
    }
    const session = queryString(req.query.session);
    const ok = queryString(req.query.ok);
    if (session === undefined || ok === undefined) {
      sendError(res, 'app.err.validation.missing_param', 'session and ok are required', 400);
      return;
    }
    if (ok !== '0' && ok !== '1') {
      sendError(res, 'app.err.validation.param_enum', 'ok must be 0 or 1', 400);
      return;
    }
    await applySeamEvent(deps, order, session, ok === '1' ? 'paid' : 'failed', undefined);
    const manifest = buildOrderManifest(deps.pageOrigin, order, undefined);
    res.status(200).type(MEDIA_PAGE).json(manifest);
  } catch (err) {
    sendThrown(res, err);
  }
}

async function handleWebhook(req: Request, res: Response, deps: PaymentDeps): Promise<void> {
  try {
    if (deps.config.provider === 'stripe' && !deps.config.webhookSecretIsLive) {
      sendError(
        res,
        'app.err.internal.server',
        'PAYMENT_WEBHOOK_SECRET is not set for stripe',
        500,
      );
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const nowSec = resolveNowSec(req);
    const xPay = headerOne(req, 'x-payment-signature');
    const stripeSig = headerOne(req, 'stripe-signature');
    const useStripe =
      deps.config.provider === 'stripe' && stripeSig !== undefined && xPay === undefined;

    let event: LockedPaymentEvent;
    if (useStripe) {
      const normalized = normalizeStripeWebhook({
        header: stripeSig,
        rawBody,
        secret: deps.config.webhookSecret,
        nowSec,
      });
      if (normalized.type === 'reject') {
        sendSignatureError(res, normalized.reason);
        return;
      }
      if (normalized.type === 'invalid') {
        sendError(res, normalized.code, normalized.message, 400);
        return;
      }
      if (normalized.type === 'ignore') {
        const current = seamForOrder(deps, normalized.orderId);
        sendApplied(res, false, current);
        return;
      }
      event = normalized.event;
    } else {
      const verified = verifyPaymentSignature(xPay, rawBody, deps.config.webhookSecret, nowSec);
      if (!verified.ok) {
        sendSignatureError(res, verified.reason);
        return;
      }
      const parsed = parseLockedEvent(rawBody);
      if (!parsed.ok) {
        sendError(res, parsed.code, parsed.message, 400);
        return;
      }
      event = parsed.event;
    }

    const order = deps.store.get(event.order_id);
    if (!order) {
      sendError(res, 'app.err.page.not_found', 'Page not found', 404);
      return;
    }
    const result = await applySeamEvent(
      deps,
      order,
      event.session_id,
      event.status,
      event.provider_ref,
    );
    sendApplied(res, result.applied, result.payment_status);
  } catch (err) {
    sendThrown(res, err);
  }
}

function sendThrown(res: Response, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof AppError) {
    res.status(err.httpStatus).type(MEDIA_ERROR).json(err.envelope);
    return;
  }
  console.error(err instanceof Error ? err.message : err);
  sendError(res, 'app.err.internal.server', 'Internal server error', 500);
}

function seamForOrder(deps: PaymentDeps, orderId: string | null): SeamStatus | null {
  if (!orderId) return null;
  const order = deps.store.get(orderId);
  return currentSeamStatus(order);
}

function parseLockedEvent(
  rawBody: Buffer,
): { ok: true; event: LockedPaymentEvent } | { ok: false; code: string; message: string } {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return {
      ok: false,
      code: 'app.err.payload.invalid_json',
      message: 'Request body is not valid JSON',
    };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'app.err.payload.invalid_json',
      message: 'Request body is not valid JSON',
    };
  }
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!LOCKED_KEYS.includes(key as (typeof LOCKED_KEYS)[number])) {
      return { ok: false, code: 'app.err.validation.unknown_param', message: 'Unknown parameter' };
    }
  }
  for (const key of LOCKED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      return {
        ok: false,
        code: 'app.err.validation.missing_param',
        message: 'Required parameter is missing',
      };
    }
  }
  const orderId = obj.order_id;
  const status = obj.status;
  const providerRef = obj.provider_ref;
  const sessionId = obj.session_id;
  if (typeof orderId !== 'string' || orderId.length < 1 || orderId.length > 128) {
    return fieldShape(typeof orderId === 'string' ? 'pattern' : 'missing');
  }
  if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 128) {
    return fieldShape(typeof sessionId === 'string' ? 'pattern' : 'missing');
  }
  if (typeof providerRef !== 'string' || providerRef.length < 1 || providerRef.length > 256) {
    return fieldShape(typeof providerRef === 'string' ? 'pattern' : 'missing');
  }
  if (status !== 'paid' && status !== 'failed') {
    return {
      ok: false,
      code: 'app.err.validation.param_enum',
      message: 'Parameter value is not in the allowed options',
    };
  }
  return {
    ok: true,
    event: {
      order_id: orderId,
      status,
      provider_ref: providerRef,
      session_id: sessionId,
    },
  };
}

function fieldShape(kind: 'missing' | 'pattern'): { ok: false; code: string; message: string } {
  if (kind === 'missing') {
    return {
      ok: false,
      code: 'app.err.validation.missing_param',
      message: 'Required parameter is missing',
    };
  }
  return {
    ok: false,
    code: 'app.err.validation.param_pattern',
    message: 'Parameter value does not match the required pattern',
  };
}

function resolveNowSec(req: Request): number {
  const hooked = req.app.locals.paymentNowSec;
  if (typeof hooked === 'number') return hooked;
  return Math.floor(Date.now() / 1000);
}

function headerOne(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function queryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value;
}

function sendApplied(res: Response, applied: boolean, paymentStatus: SeamStatus | null): void {
  res.status(200).type('application/json').json({
    ok: true,
    applied,
    payment_status: paymentStatus,
  });
}

function sendSignatureError(res: Response, reason: VerifyReason): void {
  if (reason === 'stale') {
    sendError(res, 'app.err.auth.expired', 'Payment signature timestamp outside window', 401);
    return;
  }
  sendError(res, 'app.err.auth.failed', 'Payment signature rejected', 401);
}

function sendError(res: Response, code: string, message: string, httpStatus: number): void {
  const envelope = buildErrorEnvelope(code, {
    app: '1.1',
    message,
    httpStatus,
    retryable: false,
  });
  res.status(httpStatus).type(MEDIA_ERROR).json(envelope);
}
