/**
 * Request-wire fuzz oracle.
 *
 * The request-fuzz suite exercises validateActionRequest directly; this one
 * sends mutated bodies over real HTTP to the live middleware. What it adds:
 * transport-level failures the validator never sees — wrong/missing
 * Content-Type, malformed JSON, >64 KiB bodies — plus the guarantee that a
 * rejected request ALWAYS returns a structured error envelope (4xx/5xx with
 * {app, error.code}), never a 200, never a bare 500, never a hang.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { loadValidator } from './corpus.mjs';
import { clone } from './mutations.mjs';
import { createFullDemoApp } from '../demo/full-server.mjs';
import { buildLabPages } from '../demo/protocol-lab/pages.mjs';
import { buildHotelPages } from '../demo/hotel-booking/pages.mjs';

const { ajv } = await loadValidator();
const validateReq = ajv.getSchema('action-request.json');

// reserve port then build with matching origin (CSRF checks Origin)
const { createServer: createProbe } = await import('node:http');
const probe = createProbe();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const app = await createFullDemoApp({
  sites: { lab: buildLabPages(origin), hotel: buildHotelPages(origin) },
  origin,
});
const server = app.listen(port, '127.0.0.1');
await once(server, 'listening');

const MEDIA = 'application/vnd.agent-page-action+json';
const GOOD_KEY = 'wirefuzz-12345';

const post = (path, body, headers = {}) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': MEDIA,
      'X-APP-Accept-Versions': '1.1, 1.0',
      'X-APP-Client': 'request-wire/1.0',
      'X-APP-Origin': origin,
      Origin: origin,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function expectEnvelope(res, label) {
  assert.notEqual(res.status, 200, `${label}: bad request returned 200`);
  assert.ok(res.status >= 400 && res.status < 600, `${label}: status ${res.status}`);
  const doc = await res.json().catch(() => null);
  assert.ok(doc?.error?.code, `${label}: no error envelope (status ${res.status})`);
}

const counterReq = { app: '1.1', action: 'inc', params: { delta: 1 } };

const BAD_BODIES = [
  ['drop action', (d) => void delete d.action],
  ['unknown action', (d) => void (d.action = 'no_such_action')],
  ['action bad pattern', (d) => void (d.action = 'BAD!')],
  ['params array', (d) => void (d.params = [])],
  ['params scalar', (d) => void (d.params = 7)],
  ['extra root member', (d) => void (d.zzz_evil = 1)],
  ['app bogus', (d) => void (d.app = '9.9')],
  ['wrong param type', (d) => void (d.params = { delta: 'not a number' })],
  ['unknown param', (d) => void (d.params = { delta: 1, bogus: 'x' })],
  ['client.kind bogus', (d) => void (d.client = { kind: 'skynet' })],
  [
    '65 extra params',
    (d) =>
      void (d.params = {
        delta: 1,
        ...Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, i])),
      }),
  ],
];

test('request-wire: mutated bodies get error envelopes over HTTP', async (t) => {
  for (const [label, fn] of BAD_BODIES) {
    const mutated = clone(counterReq);
    const r = fn(mutated);
    const body = r === undefined ? mutated : r;
    if (validateReq(body)) continue; // schema-legal mutations handled below
    await t.test(label, async () => {
      const res = await post('/app/lab/counter', body);
      await expectEnvelope(res, label);
    });
  }
});

test('request-wire: schema-legal but catalog-invalid bodies are rejected', async (t) => {
  // These pass action-request.json (the schema cannot see the action
  // catalog) but the middleware must still reject them.
  for (const label of ['unknown action', 'wrong param type', 'unknown param']) {
    const [, fn] = BAD_BODIES.find(([l]) => l === label);
    const body = clone(counterReq);
    fn(body);
    assert.ok(validateReq(body), `${label} unexpectedly schema-invalid`);
    await t.test(label, async () => {
      const res = await post('/app/lab/counter', body);
      await expectEnvelope(res, label);
    });
  }
});

test('request-wire: transport-level failures return envelopes', async (t) => {
  await t.test('wrong Content-Type', async () => {
    const res = await post('/app/lab/counter', counterReq, { 'Content-Type': 'text/plain' });
    await expectEnvelope(res, 'wrong content-type');
  });
  await t.test('malformed JSON', async () => {
    const res = await post('/app/lab/counter', '{not json', {});
    await expectEnvelope(res, 'malformed json');
  });
  await t.test('oversized body 413', async () => {
    const big = JSON.stringify({ ...counterReq, params: { delta: 1, pad: 'x'.repeat(70_000) } });
    const res = await post('/app/lab/counter', big, {});
    assert.equal(res.status, 413);
  });
  await t.test('body is bare array', async () => {
    const res = await post('/app/lab/counter', [1, 2, 3]);
    await expectEnvelope(res, 'bare array');
  });
});

test('request-wire: sensitive action without idempotency key is rejected', async () => {
  const res = await post('/app/hotel/checkout', {
    app: '1.1',
    action: 'confirm_booking',
    params: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone: '1' },
  });
  await expectEnvelope(res, 'missing idempotency key');
});

test('request-wire: sensitive action with malformed key is rejected', async () => {
  const res = await post(
    '/app/hotel/checkout',
    {
      app: '1.1',
      action: 'confirm_booking',
      params: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone: '1' },
    },
    { 'X-APP-Idempotency-Key': 'bad!!' },
  );
  await expectEnvelope(res, 'malformed idempotency key');
});

test('request-wire: legal requests still pass', async (t) => {
  // inc is idempotent:true so it requires the key; a legal request may still
  // hit a 428 confirmation challenge — the contract is only "not a
  // validation rejection".
  const notValidation = async (res, label) => {
    const doc = await res.json();
    assert.ok(
      !/validation\.|payload\.invalid/.test(doc?.error?.code ?? ''),
      `${label}: rejected as invalid (${res.status} ${doc?.error?.code})`,
    );
  };
  await t.test('app 1.0 request under 1.1 negotiation', async () => {
    const res = await post(
      '/app/lab/counter',
      { ...counterReq, app: '1.0' },
      { 'X-APP-Idempotency-Key': GOOD_KEY },
    );
    await notValidation(res, 'app 1.0 request');
  });
  await t.test('extra client/context members', async () => {
    const res = await post(
      '/app/lab/counter',
      {
        ...counterReq,
        client: { kind: 'test', name: 'x', future_field: true },
        context: { trace: 'abc' },
      },
      { 'X-APP-Idempotency-Key': GOOD_KEY },
    );
    await notValidation(res, 'extra members');
  });
  await t.test('sensitive with good key proceeds past validation', async () => {
    const res = await post(
      '/app/hotel/checkout',
      {
        app: '1.1',
        action: 'confirm_booking',
        params: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone: '1' },
      },
      { 'X-APP-Idempotency-Key': GOOD_KEY },
    );
    const doc = await res.json();
    // may still be a challenge/confirm flow — only param/key rejection is out
    assert.ok(!/idempotency|validation\.param/.test(doc?.error?.code ?? ''));
  });
});

test.after(() => server.close());
