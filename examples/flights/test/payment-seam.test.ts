import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { Express } from 'express';
import { createApp } from '../dist/server.js';
import { createStripeAdapter } from '../dist/payments/stripe.js';
import { signWebhook } from '../dist/payments/stub.js';
import { verifyPaymentSignature } from '../dist/payments/verify.js';

const PAGE = 'application/vnd.agent-page+json';
const ACTION = 'application/vnd.agent-page-action+json';
const ERROR = 'application/vnd.agent-page-error+json';
const ORIGIN = 'http://localhost:3456';
const SESSION = 'cs_stub_f916e4c76103abbfcef5b4f4a87c64df';
const CHECKOUT = `https://checkout.stub.test/c/${SESSION}`;
const WEBHOOK_BODY =
  '{"order_id":"ord-demo-unpaid","status":"paid","provider_ref":"pi_stub_ord-demo-unpaid","session_id":"cs_stub_f916e4c76103abbfcef5b4f4a87c64df"}';
const WEBHOOK_SIG =
  't=1750000000,v1=d557804d861fc90b2039f654451a4248d7b1dc900e4855292930ad734cc1bbf4';

const SEAM_ENV: NodeJS.ProcessEnv = {
  PORT: '3456',
  PAGE_ORIGIN: ORIGIN,
  PSP_PROVIDER: 'stub',
  PAYMENT_WEBHOOK_SECRET: 'dev-insecure',
};

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: Buffer;
  json: any;
}

function contentType(headers: http.IncomingHttpHeaders): string {
  const value = headers['content-type'];
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}

function httpCall(opts: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: opts.port,
        method: opts.method,
        path: opts.path,
        headers: {
          ...(opts.headers ?? {}),
          ...(opts.body !== undefined ? { 'Content-Length': Buffer.byteLength(opts.body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let json: unknown = null;
          if (raw.length > 0) {
            try {
              json = JSON.parse(raw.toString('utf8'));
            } catch {
              json = null;
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, json });
        });
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

async function withApp(
  env: NodeJS.ProcessEnv,
  fn: (ctx: { app: Express; port: number }) => Promise<void>,
): Promise<void> {
  const app = createApp(env);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  try {
    await fn({ app, port: address.port });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function appHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: PAGE,
    'X-APP-Accept-Versions': '1.1',
    ...(extra ?? {}),
  };
}

async function getJson(port: number, path: string): Promise<HttpResult> {
  return httpCall({ port, method: 'GET', path, headers: appHeaders() });
}

async function confirmedAction(
  port: number,
  path: string,
  action: string,
  key: string,
): Promise<HttpResult> {
  const body = JSON.stringify({ app: '1.1', action, params: {} });
  const headers = appHeaders({
    'Content-Type': ACTION,
    Origin: ORIGIN,
    'X-APP-Idempotency-Key': key,
  });
  const first = await httpCall({ port, method: 'POST', path, headers, body });
  assert.equal(first.status, 428, first.raw.toString('utf8'));
  const token = first.json?.error?.details?.confirmation_challenge?.value;
  assert.equal(typeof token, 'string');
  return httpCall({
    port,
    method: 'POST',
    path,
    headers: { ...headers, 'X-APP-Confirmation': token },
    body,
  });
}

async function postWebhook(
  port: number,
  body: string,
  signature: string,
  nowSec: number,
  app: Express,
): Promise<HttpResult> {
  app.locals.paymentNowSec = nowSec;
  return httpCall({
    port,
    method: 'POST',
    path: '/webhooks/payment',
    headers: {
      'Content-Type': 'application/json',
      'X-Payment-Signature': signature,
    },
    body,
  });
}

test('TV-P1 begin_checkout returns stub session without changing order status', async () => {
  await withApp(SEAM_ENV, async ({ port }) => {
    const before = await getJson(port, '/orders/ord-demo-unpaid/pay');
    assert.equal(before.status, 200);
    assert.equal(before.json.state.payment_status.value, 'unpaid');
    assert.equal(before.json.actions.pay_redirect.output.delegates_to, 'https://psp.example/3ds');
    assert.equal(before.json.actions.begin_checkout.output.delegates_to, null);

    const paid = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'begin_checkout',
      'seam-ord-demo-unpaid-01',
    );
    assert.equal(paid.status, 200, paid.raw.toString('utf8'));
    assert.ok(contentType(paid.headers).includes(PAGE));
    assert.equal(paid.json.page.id, 'pay-3ds');
    assert.equal(paid.json.state.payment_status.value, 'pending_payment');
    assert.equal(paid.json.state.payment_session.value, SESSION);
    assert.equal(paid.json.actions.begin_checkout.output.delegates_to, CHECKOUT);
    assert.equal(paid.json.state.order.value.status, 'awaiting_payment');
    assert.equal(
      paid.json.state.order.value.extra.session_id,
      paid.json.state.payment_session.value,
    );
    assert.equal(paid.json.state.order.value.payment.status, 'processing');
    assert.equal(paid.json.state.order.value.payment.psp, 'stub');
    assert.equal(paid.json.state.order.value.extra.provider_ref, null);
    assert.equal(paid.json.actions.pay_redirect.output.delegates_to, 'https://psp.example/3ds');
  });
});

test('TV-P2 signed webhook pays the order and a duplicate is a no-op', async () => {
  await withApp(SEAM_ENV, async ({ app, port }) => {
    assert.equal(signWebhook('dev-insecure', Buffer.from(WEBHOOK_BODY), 1750000000), WEBHOOK_SIG);
    const started = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'begin_checkout',
      'seam-ord-demo-unpaid-02',
    );
    assert.equal(started.status, 200, started.raw.toString('utf8'));

    const first = await postWebhook(port, WEBHOOK_BODY, WEBHOOK_SIG, 1750000000, app);
    assert.equal(first.status, 200, first.raw.toString('utf8'));
    assert.ok(contentType(first.headers).includes('application/json'));
    assert.deepEqual(first.json, { ok: true, applied: true, payment_status: 'paid' });

    const order = await getJson(port, '/orders/ord-demo-unpaid');
    assert.equal(order.status, 200);
    assert.equal(order.json.state.payment_status.value, 'paid');
    assert.equal(order.json.state.order.value.status, 'paid');
    assert.equal(order.json.state.order.value.payment.status, 'succeeded');
    assert.equal(order.json.state.order.value.extra.provider_ref, 'pi_stub_ord-demo-unpaid');
    const snapshot = JSON.stringify(order.json.state.order.value);

    const second = await postWebhook(port, WEBHOOK_BODY, WEBHOOK_SIG, 1750000000, app);
    assert.equal(second.status, 200, second.raw.toString('utf8'));
    assert.deepEqual(second.json, { ok: true, applied: false, payment_status: 'paid' });
    const again = await getJson(port, '/orders/ord-demo-unpaid');
    assert.equal(JSON.stringify(again.json.state.order.value), snapshot);
    assert.equal(again.json.state.payment_status.value, 'paid');
  });
});

test('TV-P3 bad and stale signatures do not change pending payment', async () => {
  await withApp(SEAM_ENV, async ({ app, port }) => {
    const started = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'begin_checkout',
      'seam-ord-demo-unpaid-03',
    );
    assert.equal(started.status, 200, started.raw.toString('utf8'));

    const flipped = `${WEBHOOK_SIG.slice(0, -1)}5`;
    const bad = await postWebhook(port, WEBHOOK_BODY, flipped, 1750000000, app);
    assert.equal(bad.status, 401, bad.raw.toString('utf8'));
    assert.equal(bad.json.error.code, 'app.err.auth.failed');
    assert.equal(bad.json.error.http_status, 401);
    assert.equal(bad.json.error.retryable, false);
    assert.ok(contentType(bad.headers).includes(ERROR));

    const mid = await getJson(port, '/orders/ord-demo-unpaid');
    assert.equal(mid.json.state.payment_status.value, 'pending_payment');
    assert.equal(mid.json.state.order.value.status, 'awaiting_payment');

    const stale = await postWebhook(port, WEBHOOK_BODY, WEBHOOK_SIG, 1750000301, app);
    assert.equal(stale.status, 401, stale.raw.toString('utf8'));
    assert.equal(stale.json.error.code, 'app.err.auth.expired');
    const after = await getJson(port, '/orders/ord-demo-unpaid');
    assert.equal(after.json.state.payment_status.value, 'pending_payment');
    assert.equal(after.json.state.order.value.status, 'awaiting_payment');
  });
});

test('TV-P4 callback rejects a session that does not belong to the order', async () => {
  await withApp(SEAM_ENV, async ({ port }) => {
    const started = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'begin_checkout',
      'seam-ord-demo-unpaid-04',
    );
    assert.equal(started.status, 200, started.raw.toString('utf8'));
    const callback = await httpCall({
      port,
      method: 'GET',
      path: '/orders/ord-demo-unpaid/pay/callback?session=cs_stub_deadbeef&ok=1',
      headers: appHeaders(),
    });
    assert.equal(callback.status, 400, callback.raw.toString('utf8'));
    assert.equal(callback.json.error.code, 'app.err.validation.param_pattern');
    const order = await getJson(port, '/orders/ord-demo-unpaid');
    assert.equal(order.json.state.payment_status.value, 'pending_payment');
    assert.equal(order.json.state.order.value.status, 'awaiting_payment');
  });
});

test('TV-P5 unset Supabase mirror does not call fetch', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('fetch should not be called');
  }) as typeof fetch;
  try {
    await withApp(SEAM_ENV, async ({ app, port }) => {
      const started = await confirmedAction(
        port,
        '/orders/ord-demo-unpaid/pay',
        'begin_checkout',
        'seam-ord-demo-unpaid-05',
      );
      assert.equal(started.status, 200, started.raw.toString('utf8'));
      const hook = await postWebhook(port, WEBHOOK_BODY, WEBHOOK_SIG, 1750000000, app);
      assert.equal(hook.status, 200, hook.raw.toString('utf8'));
      assert.equal(hook.json.payment_status, 'paid');
      const order = await getJson(port, '/orders/ord-demo-unpaid');
      assert.equal(order.json.state.payment_status.value, 'paid');
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('TV-P6 legacy pay_redirect and complete_payment still pay the demo order', async () => {
  await withApp({ PORT: '3456', PAGE_ORIGIN: ORIGIN }, async ({ port }) => {
    const before = await getJson(port, '/orders/ord-demo-unpaid/pay');
    assert.equal(before.status, 200, before.raw.toString('utf8'));
    assert.equal(before.json.actions.pay_redirect.output.delegates_to, 'https://psp.example/3ds');

    const redirected = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'pay_redirect',
      'legacy-pay-redirect-01',
    );
    assert.equal(redirected.status, 200, redirected.raw.toString('utf8'));

    const completed = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'complete_payment',
      'legacy-complete-pay-01',
    );
    assert.equal(completed.status, 303, completed.raw.toString('utf8'));

    const order = await getJson(port, '/orders/ord-demo-unpaid');
    assert.equal(order.status, 200);
    assert.equal(order.json.state.order.value.status, 'paid');
    assert.equal(order.json.state.order.value.payment.status, 'succeeded');
  });
});

test('callback ok=1 pays and a refresh stays paid', async () => {
  await withApp(SEAM_ENV, async ({ port }) => {
    const started = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'begin_checkout',
      'seam-ord-demo-unpaid-cb',
    );
    assert.equal(started.status, 200, started.raw.toString('utf8'));
    const path = `/orders/ord-demo-unpaid/pay/callback?session=${SESSION}&ok=1`;
    const callback = await httpCall({
      port,
      method: 'GET',
      path,
      headers: { Accept: 'text/html' },
    });
    assert.equal(callback.status, 200, callback.raw.toString('utf8'));
    assert.ok(contentType(callback.headers).includes(PAGE));
    assert.equal(callback.json.page.id, 'flight-order');
    assert.equal(callback.json.state.payment_status.value, 'paid');
    assert.equal(callback.json.state.order.value.status, 'paid');
    assert.equal(callback.json.state.order.value.payment.status, 'succeeded');
    assert.equal(callback.json.state.payment_session.value, SESSION);

    const refresh = await httpCall({ port, method: 'GET', path, headers: { Accept: 'text/html' } });
    assert.equal(refresh.status, 200);
    assert.equal(refresh.json.state.payment_status.value, 'paid');
    assert.equal(refresh.json.state.order.value.status, 'paid');
  });
});

test('stripe createSession posts the checkout form and reads id and url', async () => {
  const original = globalThis.fetch;
  let captured: {
    url: string;
    method: string;
    authorization: string;
    contentType: string;
    body: string;
  } | null = null;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    captured = {
      url: String(url),
      method: init?.method ?? '',
      authorization: headers.Authorization ?? '',
      contentType: headers['Content-Type'] ?? '',
      body: String(init?.body ?? ''),
    };
    return new Response(
      JSON.stringify({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const adapter = createStripeAdapter({
      secretKey: 'sk_test_example',
      baseUrl: 'https://api.stripe.com',
    });
    const result = await adapter.createSession(
      { id: 'ord-demo-unpaid', currency: 'GBP', total: 64000, scale: 2, sku: 'fl-002' },
      ORIGIN,
    );
    assert.ok(captured);
    assert.equal(captured.method, 'POST');
    assert.ok(captured.url.endsWith('/v1/checkout/sessions'));
    assert.equal(captured.authorization, 'Bearer sk_test_example');
    assert.ok(captured.contentType.startsWith('application/x-www-form-urlencoded'));
    assert.ok(captured.body.includes('mode=payment'));
    assert.ok(captured.body.includes('line_items[0][price_data][unit_amount]=64000'));
    assert.ok(captured.body.includes('line_items[0][price_data][currency]=gbp'));
    assert.deepEqual(result, {
      session_id: 'cs_test_123',
      checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('supabase mirror posts on a real transition and not on a duplicate', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('', { status: 201 });
  }) as typeof fetch;
  try {
    await withApp(
      {
        ...SEAM_ENV,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_KEY: 'service-role-test',
        SUPABASE_ORDERS_TABLE: 'orders',
      },
      async ({ app, port }) => {
        const started = await confirmedAction(
          port,
          '/orders/ord-demo-unpaid/pay',
          'begin_checkout',
          'seam-ord-demo-unpaid-mirror',
        );
        assert.equal(started.status, 200, started.raw.toString('utf8'));
        const hook = await postWebhook(port, WEBHOOK_BODY, WEBHOOK_SIG, 1750000000, app);
        assert.equal(hook.status, 200, hook.raw.toString('utf8'));
        const again = await postWebhook(port, WEBHOOK_BODY, WEBHOOK_SIG, 1750000000, app);
        assert.equal(again.json.applied, false);
      },
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://example.supabase.co/rest/v1/orders?on_conflict=id');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers.apikey, 'service-role-test');
    assert.equal(headers.Authorization, 'Bearer service-role-test');
    assert.equal(headers.Prefer, 'resolution=merge-duplicates,return=minimal');
    const first = JSON.parse(String(calls[0]?.init?.body));
    const second = JSON.parse(String(calls[1]?.init?.body));
    assert.equal(first.payment_status, 'pending_payment');
    assert.equal(first.order_status, 'awaiting_payment');
    assert.equal(first.id, 'ord-demo-unpaid');
    assert.equal(first.session_id, SESSION);
    assert.equal(first.provider_ref, null);
    assert.equal(first.currency, 'GBP');
    assert.equal(first.total, 64000);
    assert.equal(second.payment_status, 'paid');
    assert.equal(second.order_status, 'paid');
    assert.equal(second.provider_ref, 'pi_stub_ord-demo-unpaid');
  } finally {
    globalThis.fetch = original;
  }
});

test('stripe mode rejects the dev webhook secret before verify', async () => {
  await withApp(
    {
      PORT: '3456',
      PAGE_ORIGIN: ORIGIN,
      PSP_PROVIDER: 'stripe',
    },
    async ({ port }) => {
      const res = await httpCall({
        port,
        method: 'POST',
        path: '/webhooks/payment',
        headers: {
          'Content-Type': 'application/json',
          'X-Payment-Signature': WEBHOOK_SIG,
        },
        body: WEBHOOK_BODY,
      });
      assert.equal(res.status, 500, res.raw.toString('utf8'));
      assert.equal(res.json.error.code, 'app.err.internal.server');
      assert.equal(res.json.error.message, 'PAYMENT_WEBHOOK_SECRET is not set for stripe');
      assert.equal(res.json.error.retryable, false);
      const order = await getJson(port, '/orders/ord-demo-unpaid');
      assert.equal(order.json.state.payment_status.value, 'unpaid');
      assert.equal(order.json.state.order.value.status, 'awaiting_payment');
    },
  );
});

test('a paid webhook after a failed callback stays failed', async () => {
  await withApp(SEAM_ENV, async ({ app, port }) => {
    const started = await confirmedAction(
      port,
      '/orders/ord-demo-unpaid/pay',
      'begin_checkout',
      'seam-ord-demo-unpaid-fail',
    );
    assert.equal(started.status, 200, started.raw.toString('utf8'));
    const cancel = await httpCall({
      port,
      method: 'GET',
      path: `/orders/ord-demo-unpaid/pay/callback?session=${SESSION}&ok=0`,
    });
    assert.equal(cancel.status, 200, cancel.raw.toString('utf8'));
    assert.equal(cancel.json.state.payment_status.value, 'failed');
    assert.equal(cancel.json.state.order.value.status, 'failed');
    assert.equal(cancel.json.state.order.value.payment.status, 'failed');
    const late = await postWebhook(port, WEBHOOK_BODY, WEBHOOK_SIG, 1750000000, app);
    assert.equal(late.status, 200, late.raw.toString('utf8'));
    assert.deepEqual(late.json, { ok: true, applied: false, payment_status: 'failed' });
    const order = await getJson(port, '/orders/ord-demo-unpaid');
    assert.equal(order.json.state.payment_status.value, 'failed');
    assert.equal(order.json.state.order.value.status, 'failed');
  });
});

test('webhook signature window of 300 seconds is accepted', () => {
  const raw = Buffer.from(WEBHOOK_BODY);
  const header = signWebhook('dev-insecure', raw, 1750000000);
  assert.equal(verifyPaymentSignature(header, raw, 'dev-insecure', 1750000300).ok, true);
  assert.deepEqual(verifyPaymentSignature(header, raw, 'dev-insecure', 1750000301), {
    ok: false,
    reason: 'stale',
  });
});
