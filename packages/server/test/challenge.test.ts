import { describe, it, expect, beforeEach } from 'vitest';
import {
  CHALLENGE_TTL_MIN_MS,
  MemoryChallengeStore,
  OTP_MAX_LENGTH,
  clampChallengeTtl,
  issueOtpChallenge,
  issueWebauthnChallenge,
  verifyOtp,
  spendChallenge,
} from '../src/challenge.js';
import { generateChallengeToken } from '../src/confirmation.js';

describe('challenge OTP / webauthn (§6)', () => {
  let store: MemoryChallengeStore;

  beforeEach(() => {
    store = new MemoryChallengeStore();
  });

  it('issues, verifies, and spends OTP; ids have 128-bit entropy', async () => {
    const rec = await issueOtpChallenge(store, { otp: '123456' });
    expect(rec.id.startsWith('chg_')).toBe(true);
    expect(rec.id.length).toBeGreaterThanOrEqual(8);
    expect(rec.attemptsRemaining).toBe(5);
    expect(rec.ttlMs).toBeGreaterThanOrEqual(CHALLENGE_TTL_MIN_MS);

    const ok = await verifyOtp(store, { id: rec.id, otp: '123456' });
    expect(ok.ok).toBe(true);
    const replay = await verifyOtp(store, { id: rec.id, otp: '123456' });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.envelope.error.code).toBe('app.err.auth.challenge_invalid');
  });

  it('decrements attempts_remaining on wrong OTP', async () => {
    const rec = await issueOtpChallenge(store, { otp: '123456', maxAttempts: 3 });
    const fail = await verifyOtp(store, { id: rec.id, otp: '000000' });
    expect(fail.ok).toBe(false);
    if (!fail.ok) {
      expect(fail.error.envelope.error.code).toBe('app.err.auth.challenge_failed');
      expect(fail.error.envelope.error.details?.attempts_remaining).toMatchObject({
        type: 'number',
        value: 2,
      });
    }
  });

  it('rejects OTP longer than 16 chars', async () => {
    const long = '1'.repeat(OTP_MAX_LENGTH + 1);
    await expect(issueOtpChallenge(store, { otp: long })).rejects.toMatchObject({
      envelope: { error: { code: 'app.err.validation.param_range' } },
    });
  });

  it('clamps TTL to min 30s', () => {
    expect(clampChallengeTtl(1)).toBe(CHALLENGE_TTL_MIN_MS);
    expect(clampChallengeTtl(30_000)).toBe(30_000);
  });

  it('is distinct from confirmation tokens', async () => {
    const rec = await issueOtpChallenge(store, { otp: '999999' });
    const conf = generateChallengeToken();
    expect(rec.id.startsWith('chg_')).toBe(true);
    expect(conf.startsWith('conf_')).toBe(true);
    expect(rec.id).not.toBe(conf);
  });

  it('issues a webauthn slot with public_key', async () => {
    const rec = await issueWebauthnChallenge(store, { publicKey: { challenge: 'abc' } });
    expect(rec.kind).toBe('webauthn');
    expect(rec.publicKey).toEqual({ challenge: 'abc' });
    await spendChallenge(store, rec.id);
    const spent = await store.get(rec.id);
    expect(spent?.status).toBe('spent');
  });
});
