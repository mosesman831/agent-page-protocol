/**
 * MFA / OTP / passkey challenge channel (SPEC §6).
 * Distinct from confirmation (v0.4 §10.4): OTP mutates the body; confirmation binds exact bytes.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import type { ChallengeChannel, ChallengeKind, ChallengeObject } from './types.js';

export const CHALLENGE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
export const OTP_MAX_LENGTH = 16;
export const CHALLENGE_TTL_MIN_MS = 30_000;
export const CHALLENGE_TTL_DEFAULT_MS = 300_000;
export const CHALLENGE_TTL_MAX_MS = 600_000;
export const DEFAULT_MAX_ATTEMPTS = 5;

export type ChallengeSlotStatus = 'issued' | 'spent' | 'expired' | 'locked';

export interface ChallengeRecord {
  id: string;
  kind: ChallengeKind;
  channel?: ChallengeChannel;
  param: string;
  otpHash?: string;
  publicKey?: Record<string, unknown>;
  attemptsRemaining: number;
  maxAttempts: number;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
  status: ChallengeSlotStatus;
  webauthnVerified?: boolean;
}

export interface ChallengeStore {
  get(id: string): Promise<ChallengeRecord | null>;
  set(record: ChallengeRecord): Promise<void>;
}

export class MemoryChallengeStore implements ChallengeStore {
  private readonly map = new Map<string, ChallengeRecord>();

  async get(id: string): Promise<ChallengeRecord | null> {
    return this.map.get(id) ?? null;
  }
  async set(record: ChallengeRecord): Promise<void> {
    this.map.set(record.id, record);
  }
  clear(): void {
    this.map.clear();
  }
}

export function mintChallengeId(): string {
  return `chg_${randomBytes(16).toString('base64url')}`;
}

export function clampChallengeTtl(ttlMs?: number): number {
  const ttl = ttlMs ?? CHALLENGE_TTL_DEFAULT_MS;
  if (!Number.isFinite(ttl)) return CHALLENGE_TTL_DEFAULT_MS;
  return Math.min(CHALLENGE_TTL_MAX_MS, Math.max(CHALLENGE_TTL_MIN_MS, Math.floor(ttl)));
}

function hashOtp(otp: string): string {
  return createHash('sha256').update(otp, 'utf8').digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function challengeToObject(record: ChallengeRecord): ChallengeObject {
  return {
    id: record.id,
    kind: record.kind,
    channel: record.channel,
    param: record.param,
    ttl_ms: record.ttlMs,
    expires_at: new Date(record.expiresAt).toISOString(),
    attempts_remaining: record.attemptsRemaining,
    max_attempts: record.maxAttempts,
    public_key: record.publicKey,
  };
}

export async function issueOtpChallenge(
  store: ChallengeStore,
  opts: {
    otp: string;
    kind?: ChallengeKind;
    channel?: ChallengeChannel;
    param?: string;
    ttlMs?: number;
    maxAttempts?: number;
    now?: number;
  },
): Promise<ChallengeRecord> {
  if (opts.otp.length > OTP_MAX_LENGTH) {
    throw new AppError('app.err.validation.param_range', {
      message: `OTP exceeds max ${OTP_MAX_LENGTH} chars`,
      path: '/params/otp',
    });
  }
  const now = opts.now ?? Date.now();
  const ttlMs = clampChallengeTtl(opts.ttlMs);
  const maxAttempts = Math.min(10, Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const record: ChallengeRecord = {
    id: mintChallengeId(),
    kind: opts.kind ?? 'otp',
    channel: opts.channel ?? 'email',
    param: opts.param ?? 'otp',
    otpHash: hashOtp(opts.otp),
    attemptsRemaining: maxAttempts,
    maxAttempts,
    createdAt: now,
    expiresAt: now + ttlMs,
    ttlMs,
    status: 'issued',
  };
  await store.set(record);
  return record;
}

export async function issueWebauthnChallenge(
  store: ChallengeStore,
  opts: {
    publicKey: Record<string, unknown>;
    ttlMs?: number;
    now?: number;
  },
): Promise<ChallengeRecord> {
  const now = opts.now ?? Date.now();
  const ttlMs = clampChallengeTtl(opts.ttlMs);
  const record: ChallengeRecord = {
    id: mintChallengeId(),
    kind: 'webauthn',
    param: 'credential',
    publicKey: opts.publicKey,
    attemptsRemaining: 1,
    maxAttempts: 1,
    createdAt: now,
    expiresAt: now + ttlMs,
    ttlMs,
    status: 'issued',
  };
  await store.set(record);
  return record;
}

export type ChallengeVerifyResult =
  { ok: true; record: ChallengeRecord } | { ok: false; error: AppError };

function refreshStatus(record: ChallengeRecord, now: number): ChallengeSlotStatus {
  if (record.status === 'spent' || record.status === 'locked') return record.status;
  if (now >= record.expiresAt) return 'expired';
  return record.status;
}

export async function verifyOtp(
  store: ChallengeStore,
  opts: { id: string; otp: string; now?: number },
): Promise<ChallengeVerifyResult> {
  if (opts.otp.length > OTP_MAX_LENGTH) {
    return {
      ok: false,
      error: new AppError('app.err.validation.param_range', {
        message: `OTP exceeds max ${OTP_MAX_LENGTH} chars`,
        path: '/params/otp',
      }),
    };
  }
  const now = opts.now ?? Date.now();
  const record = await store.get(opts.id);
  if (!record) {
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_invalid', { message: 'Challenge id is invalid' }),
    };
  }
  const status = refreshStatus(record, now);
  if (status === 'spent') {
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_invalid', { message: 'Challenge already spent' }),
    };
  }
  if (status === 'expired') {
    record.status = 'expired';
    await store.set(record);
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_expired', { message: 'Challenge expired' }),
    };
  }
  if (status === 'locked' || record.attemptsRemaining <= 0) {
    record.status = 'locked';
    await store.set(record);
    return {
      ok: false,
      error: new AppError('app.err.auth.locked', { message: 'Identity is locked' }),
    };
  }
  if (!record.otpHash || !hashesEqual(record.otpHash, hashOtp(opts.otp))) {
    record.attemptsRemaining -= 1;
    if (record.attemptsRemaining <= 0) {
      record.status = 'locked';
      await store.set(record);
      return {
        ok: false,
        error: new AppError('app.err.auth.locked', { message: 'Identity is locked' }),
      };
    }
    await store.set(record);
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_failed', {
        message: 'Verification code is incorrect',
        details: {
          attempts_remaining: { type: 'number', value: record.attemptsRemaining },
        },
      }),
    };
  }
  record.status = 'spent';
  record.attemptsRemaining = 0;
  await store.set(record);
  return { ok: true, record };
}

export async function spendChallenge(store: ChallengeStore, id: string): Promise<void> {
  const record = await store.get(id);
  if (!record) return;
  record.status = 'spent';
  await store.set(record);
}

/**
 * Verify a webauthn assertion against the issued slot.
 * Servers MUST NOT accept raw assertion JSON that does not verify against the challenge slot.
 * This helper checks slot binding; cryptographic verify is provided by `verifyAssertion`.
 */
export async function verifyWebauthn(
  store: ChallengeStore,
  opts: {
    id: string;
    credential: unknown;
    now?: number;
    verifyAssertion?: (credential: unknown, publicKey: Record<string, unknown>) => boolean;
  },
): Promise<ChallengeVerifyResult> {
  const now = opts.now ?? Date.now();
  const record = await store.get(opts.id);
  if (!record || record.kind !== 'webauthn') {
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_invalid', { message: 'Challenge id is invalid' }),
    };
  }
  const status = refreshStatus(record, now);
  if (status === 'spent') {
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_invalid', { message: 'Challenge already spent' }),
    };
  }
  if (status === 'expired') {
    record.status = 'expired';
    await store.set(record);
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_expired', { message: 'Challenge expired' }),
    };
  }
  if (opts.credential === null || typeof opts.credential !== 'object') {
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_failed', { message: 'Invalid credential' }),
    };
  }
  const verifier = opts.verifyAssertion ?? (() => true);
  if (!record.publicKey || !verifier(opts.credential, record.publicKey)) {
    return {
      ok: false,
      error: new AppError('app.err.auth.challenge_failed', { message: 'Assertion did not verify' }),
    };
  }
  record.status = 'spent';
  record.webauthnVerified = true;
  await store.set(record);
  return { ok: true, record };
}

/** Resend spends the old id and issues a new one. */
export async function resendOtpChallenge(
  store: ChallengeStore,
  opts: { previousId: string; otp: string; ttlMs?: number; now?: number },
): Promise<ChallengeRecord> {
  const prev = await store.get(opts.previousId);
  if (prev && prev.status === 'issued') {
    prev.status = 'spent';
    await store.set(prev);
  }
  return issueOtpChallenge(store, {
    otp: opts.otp,
    kind: prev?.kind ?? 'otp',
    param: prev?.param ?? 'otp',
    ttlMs: opts.ttlMs ?? prev?.ttlMs,
    maxAttempts: prev?.maxAttempts,
    now: opts.now,
  });
}
