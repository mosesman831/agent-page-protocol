import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryConfirmationStore,
  issueConfirmationChallenge,
  verifyConfirmation,
  consumeConfirmation,
  CONFIRMATION_TTL_MS,
  sha256Hex,
  UUID_MODE_PREFIX,
} from '../src/confirmation.js';

const BODY_A = Buffer.from(
  JSON.stringify({ app: '1.0', action: 'book', params: { flight_id: 'fl-1' } }),
  'utf8',
);
const BODY_B = Buffer.from(
  JSON.stringify({ app: '1.0', action: 'book', params: { flight_id: 'fl-2' } }),
  'utf8',
);
const BODY_EMPTY = Buffer.from(JSON.stringify({ app: '1.0', action: 'book', params: {} }), 'utf8');

describe('Confirmation challenge-echo (C10 raw body binding)', () => {
  let store: MemoryConfirmationStore;

  beforeEach(() => {
    store = new MemoryConfirmationStore();
  });

  it('issues challenge bound to SHA-256 of exact raw body bytes', async () => {
    const binding = await issueConfirmationChallenge(store, {
      actionId: 'book',
      rawBody: BODY_A,
      pageVersion: 'v2',
      sessionId: 'sess1',
    });
    expect(binding.bodySha256).toBe(sha256Hex(BODY_A));
    expect(binding.bodySha256).not.toBe(sha256Hex(BODY_B));

    const v = await verifyConfirmation(store, {
      token: binding.token,
      actionId: 'book',
      rawBody: BODY_A,
      pageVersion: 'v2',
      sessionId: 'sess1',
    });
    expect(v.ok).toBe(true);
  });

  it('rejects mutated raw body bytes', async () => {
    const binding = await issueConfirmationChallenge(store, {
      actionId: 'book',
      rawBody: BODY_A,
      pageVersion: 'v2',
      sessionId: 'sess1',
    });

    const v = await verifyConfirmation(store, {
      token: binding.token,
      actionId: 'book',
      rawBody: BODY_B,
      pageVersion: 'v2',
      sessionId: 'sess1',
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('body_mismatch');
  });

  it('is single-use', async () => {
    const binding = await issueConfirmationChallenge(store, {
      actionId: 'book',
      rawBody: BODY_EMPTY,
      pageVersion: 'v1',
      sessionId: 's',
    });
    await consumeConfirmation(store, binding.token);
    const v = await verifyConfirmation(store, {
      token: binding.token,
      actionId: 'book',
      rawBody: BODY_EMPTY,
      pageVersion: 'v1',
      sessionId: 's',
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('used');
  });

  it('expires after TTL', async () => {
    const binding = await issueConfirmationChallenge(store, {
      actionId: 'book',
      rawBody: BODY_EMPTY,
      pageVersion: 'v1',
      sessionId: 's',
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const v = await verifyConfirmation(store, {
      token: binding.token,
      actionId: 'book',
      rawBody: BODY_EMPTY,
      pageVersion: 'v1',
      sessionId: 's',
    });
    expect(v.ok).toBe(false);
    expect(CONFIRMATION_TTL_MS).toBe(300_000);
  });

  it('binds to page.version', async () => {
    const binding = await issueConfirmationChallenge(store, {
      actionId: 'book',
      rawBody: BODY_EMPTY,
      pageVersion: 'v1',
      sessionId: 's',
    });
    const v = await verifyConfirmation(store, {
      token: binding.token,
      actionId: 'book',
      rawBody: BODY_EMPTY,
      pageVersion: 'v2',
      sessionId: 's',
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('version_mismatch');
  });

  it('rejects Mode B uuid-mode when X-APP-Client kind is agent', async () => {
    const token = `${UUID_MODE_PREFIX}550e8400-e29b-41d4-a716-446655440000`;
    const v = await verifyConfirmation(store, {
      token,
      actionId: 'book',
      rawBody: BODY_A,
      pageVersion: 'v1',
      sessionId: 's',
      clientHeader: 'agent/test-bot',
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('agent_uuid_mode');
  });

  it('accepts Mode B uuid-mode for renderer clients', async () => {
    const token = `${UUID_MODE_PREFIX}550e8400-e29b-41d4-a716-446655440000`;
    const v = await verifyConfirmation(store, {
      token,
      actionId: 'book',
      rawBody: BODY_A,
      pageVersion: 'v1',
      sessionId: 's',
      clientHeader: 'renderer/extension',
    });
    expect(v.ok).toBe(true);
  });
});
