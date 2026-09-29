import { describe, it, expect } from 'vitest';
import {
  MemoryIdempotencyStore,
  beginIdempotentRequest,
  storeIdempotentResponse,
  evaluateChallengeContinuation,
  bindChallengeBaseBody,
  isChallengeContinuationBody,
} from '../src/idempotency.js';

const BASE = Buffer.from(
  JSON.stringify({
    app: '1.1',
    action: 'submit_credentials',
    params: { email: 'a@b.c', password: 'x' },
  }),
);
const WITH_OTP = Buffer.from(
  JSON.stringify({
    app: '1.1',
    action: 'submit_credentials',
    params: { email: 'a@b.c', password: 'x', otp: '123456' },
  }),
);
const MUTATED = Buffer.from(
  JSON.stringify({
    app: '1.1',
    action: 'submit_credentials',
    params: { email: 'a@b.c', password: 'CHANGED', otp: '123456' },
  }),
);

describe('K3 MF-4 challenge continuation', () => {
  it('detects continuation body vs mutated password', () => {
    expect(isChallengeContinuationBody(BASE, WITH_OTP)).toBe(true);
    expect(isChallengeContinuationBody(BASE, MUTATED)).toBe(false);
  });

  it('allows one continuation then rejects a second challenge id', async () => {
    const store = new MemoryIdempotencyStore();
    const rec = await beginIdempotentRequest(store, 'anon', 'K', 'hash1');
    await storeIdempotentResponse(store, 'anon', 'K', 'hash1', {
      status: 428,
      headers: {},
      body: {
        app: '1.1',
        error: {
          code: 'app.err.auth.challenge_required',
          message: 'mfa',
          retryable: false,
          http_status: 428,
          details: { challenge: { type: 'string', value: 'chg_1' } },
        },
      },
    });
    await bindChallengeBaseBody(store, 'anon', 'K', BASE, 'chg_1');
    const stored = await store.get('anon', 'K');
    expect(stored?.challengeId).toBe('chg_1');

    const ok = evaluateChallengeContinuation({
      record: stored!,
      selectedVersion: '1.1',
      challengeHeader: 'chg_1',
      newRawBody: WITH_OTP,
    });
    expect(ok.type).toBe('continue');

    const otherId = evaluateChallengeContinuation({
      record: stored!,
      selectedVersion: '1.1',
      challengeHeader: 'chg_OTHER',
      newRawBody: WITH_OTP,
    });
    expect(otherId.type).toBe('invalid');

    await storeIdempotentResponse(store, 'anon', 'K', 'hash2', {
      status: 200,
      headers: {},
      body: { app: '1.1', page: { id: 'x', url: '/', version: 'v1' }, state: {} },
    });
    const after = await store.get('anon', 'K');
    const second = evaluateChallengeContinuation({
      record: after!,
      selectedVersion: '1.1',
      challengeHeader: 'chg_1',
      newRawBody: WITH_OTP,
    });
    expect(second.type).toBe('invalid');
    void rec;
  });
});
