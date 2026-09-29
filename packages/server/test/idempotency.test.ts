import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryIdempotencyStore,
  hashRequestBody,
  computeIdempotencyFingerprint,
  lookupIdempotency,
  beginIdempotentRequest,
  storeIdempotentResponse,
  idempotencyScope,
} from '../src/idempotency.js';

describe('Idempotency store (§6.7)', () => {
  let store: MemoryIdempotencyStore;

  beforeEach(() => {
    store = new MemoryIdempotencyStore();
  });

  it('replays same key + same fingerprint', async () => {
    const scope = idempotencyScope('sess', 'page');
    const raw = Buffer.from(
      JSON.stringify({ app: '1.0', action: 'pay', params: { amount: 10 } }),
      'utf8',
    );
    const fp = computeIdempotencyFingerprint('POST', '/shop', 'pay', raw);
    await storeIdempotentResponse(store, scope, 'idem_abc12345', fp, {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.agent-page-diff+json' },
      body: { ok: true },
    });

    const look = await lookupIdempotency(store, scope, 'idem_abc12345', fp);
    expect(look.type).toBe('replay');
    expect(look.record?.response?.body).toEqual({ ok: true });
  });

  it('conflicts when same key + different fingerprint', async () => {
    const scope = idempotencyScope('sess', 'page');
    const raw1 = Buffer.from(
      JSON.stringify({ app: '1.0', action: 'pay', params: { amount: 10 } }),
      'utf8',
    );
    const raw2 = Buffer.from(
      JSON.stringify({ app: '1.0', action: 'pay', params: { amount: 99 } }),
      'utf8',
    );
    const fp1 = computeIdempotencyFingerprint('POST', '/shop', 'pay', raw1);
    const fp2 = computeIdempotencyFingerprint('POST', '/shop', 'pay', raw2);
    await storeIdempotentResponse(store, scope, 'idem_abc12345', fp1, {
      status: 200,
      headers: {},
      body: { first: true },
    });

    const look = await lookupIdempotency(store, scope, 'idem_abc12345', fp2);
    expect(look.type).toBe('conflict');
  });

  it('returns in_flight while first execution is pending', async () => {
    const scope = idempotencyScope('sess');
    const raw = Buffer.from('{"app":"1.0","action":"pay"}', 'utf8');
    const fp = computeIdempotencyFingerprint('POST', '/pay', 'pay', raw);
    await beginIdempotentRequest(store, scope, 'idem_inflight1', fp);
    const look = await lookupIdempotency(store, scope, 'idem_inflight1', fp);
    expect(look.type).toBe('in_flight');
  });

  it('misses unknown keys', async () => {
    const look = await lookupIdempotency(
      store,
      'scope',
      'idem_unknown',
      hashRequestBody(Buffer.from('{}')),
    );
    expect(look.type).toBe('miss');
  });

  it('fingerprint uses exact raw bytes (key order matters)', () => {
    const a = computeIdempotencyFingerprint(
      'POST',
      '/x',
      'act',
      Buffer.from('{"b":1,"a":2}', 'utf8'),
    );
    const b = computeIdempotencyFingerprint(
      'POST',
      '/x',
      'act',
      Buffer.from('{"a":2,"b":1}', 'utf8'),
    );
    expect(a).not.toBe(b);
  });

  it('fingerprint includes method, request-target, and actionId', () => {
    const raw = Buffer.from('{}', 'utf8');
    const a = computeIdempotencyFingerprint('POST', '/a', 'x', raw);
    const b = computeIdempotencyFingerprint('POST', '/b', 'x', raw);
    const c = computeIdempotencyFingerprint('POST', '/a', 'y', raw);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
