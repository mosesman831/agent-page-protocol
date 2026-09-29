/**
 * Identity flow helpers: login / logout / signup / recovery (SPEC §4).
 * Generic auth.failed (no enumeration). Lockout after 5 failures.
 * Cache-Control: private, no-store on identity responses.
 * Rotate session id on authenticate.
 */

import { randomBytes } from 'node:crypto';
import { AppError, detailString } from './errors.js';

export const IDENTITY_CACHE_CONTROL = 'private, no-store';
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export function identityCacheHeaders(): Record<string, string> {
  return { 'Cache-Control': IDENTITY_CACHE_CONTROL };
}

export function newSessionId(): string {
  return `sess_${randomBytes(16).toString('base64url')}`;
}

/** Rotate the session identifier on successful authenticate (session-fixation defense). */
export function rotateSessionId(_previous?: string | null): string {
  return newSessionId();
}

export interface LockoutRecord {
  failures: number;
  lockedUntil: number | null;
}

export interface IdentityLockoutStore {
  get(identityKey: string): LockoutRecord | undefined;
  set(identityKey: string, record: LockoutRecord): void;
  delete(identityKey: string): void;
}

export class MemoryIdentityLockoutStore implements IdentityLockoutStore {
  private readonly map = new Map<string, LockoutRecord>();

  get(identityKey: string): LockoutRecord | undefined {
    return this.map.get(identityKey);
  }

  set(identityKey: string, record: LockoutRecord): void {
    this.map.set(identityKey, record);
  }

  delete(identityKey: string): void {
    this.map.delete(identityKey);
  }

  clear(): void {
    this.map.clear();
  }
}

export function isIdentityLocked(
  store: IdentityLockoutStore,
  identityKey: string,
  now = Date.now(),
): { locked: boolean; retryAfterMs?: number } {
  const rec = store.get(identityKey);
  if (!rec?.lockedUntil) return { locked: false };
  if (now >= rec.lockedUntil) {
    store.delete(identityKey);
    return { locked: false };
  }
  return { locked: true, retryAfterMs: rec.lockedUntil - now };
}

function recordFailure(
  store: IdentityLockoutStore,
  identityKey: string,
  now = Date.now(),
): LockoutRecord {
  const prev = store.get(identityKey);
  const failures = (prev?.failures ?? 0) + 1;
  const rec: LockoutRecord = {
    failures,
    lockedUntil: failures >= LOGIN_MAX_FAILURES ? now + LOGIN_LOCKOUT_MS : null,
  };
  store.set(identityKey, rec);
  return rec;
}

export type LoginAttemptResult =
  { ok: true; sessionId: string; rotated: true } | { ok: false; error: AppError };

/**
 * Evaluate a password (or primary-factor) login.
 * Failures are generic `auth.failed` (MUST NOT say whether the identity exists).
 * After 5 failures the identity is locked (`auth.locked`).
 * Success rotates the session id.
 */
export function evaluateLoginAttempt(opts: {
  identityKey: string;
  credentialsValid: boolean;
  store: IdentityLockoutStore;
  previousSessionId?: string | null;
  now?: number;
}): LoginAttemptResult {
  const now = opts.now ?? Date.now();
  const lock = isIdentityLocked(opts.store, opts.identityKey, now);
  if (lock.locked) {
    return {
      ok: false,
      error: new AppError('app.err.auth.locked', {
        retry_after_ms: lock.retryAfterMs,
        message: 'Identity is locked',
      }),
    };
  }
  if (!opts.credentialsValid) {
    const rec = recordFailure(opts.store, opts.identityKey, now);
    if (rec.lockedUntil) {
      return {
        ok: false,
        error: new AppError('app.err.auth.locked', {
          retry_after_ms: rec.lockedUntil - now,
          message: 'Identity is locked',
        }),
      };
    }
    const remaining = Math.max(0, LOGIN_MAX_FAILURES - rec.failures);
    return {
      ok: false,
      error: new AppError('app.err.auth.failed', {
        message: 'Authentication failed',
        details: {
          attempts_remaining: {
            type: 'number',
            value: remaining,
            label: 'attempts_remaining',
          },
        },
      }),
    };
  }
  opts.store.delete(opts.identityKey);
  return { ok: true, sessionId: rotateSessionId(opts.previousSessionId), rotated: true };
}

/**
 * Duplicate signup: generic identity_conflict (do not confirm which field collided).
 */
export function evaluateSignup(opts: {
  identityExists: boolean;
}): { ok: true } | { ok: false; error: AppError } {
  if (opts.identityExists) {
    return {
      ok: false,
      error: new AppError('app.err.auth.identity_conflict', {
        message: 'Could not create account',
      }),
    };
  }
  return { ok: true };
}

/**
 * Recovery start is always a generic success (no account enumeration).
 */
export function recoveryStartResult(): {
  ok: true;
  message: string;
} {
  return {
    ok: true,
    message: 'If that account exists, we sent a message',
  };
}

export interface LogoutResult {
  sessionIdInvalidated: true;
  resumeInvalidated: true;
  sessionEpoch: number;
  cacheHeaders: Record<string, string>;
}

export function evaluateLogout(opts: { sessionEpoch: number; allDevices?: boolean }): LogoutResult {
  void opts.allDevices;
  return {
    sessionIdInvalidated: true,
    resumeInvalidated: true,
    sessionEpoch: opts.sessionEpoch + 1,
    cacheHeaders: identityCacheHeaders(),
  };
}

/** 401 auth.required details when identity_flows is advertised. */
export function authRequiredDetails(loginUrl: string, flowId = 'login') {
  return {
    login_url: detailString(loginUrl, 'login_url'),
    flow_id: detailString(flowId, 'flow_id'),
  };
}
