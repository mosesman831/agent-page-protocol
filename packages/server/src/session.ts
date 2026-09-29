/**
 * Session epoch, expiry, refresh family, resume token mint/rotate/spend (SPEC §5, §13).
 *
 * MF-6a: rotate resume on authenticated use when session_resume is enabled and
 * the request was authenticated by resume ALONE. Rotation MUST NOT invalidate
 * the underlying session (refresh tokens unchanged).
 *
 * Resume token: 16-256 chars [A-Za-z0-9._~-]+, entropy >= 128 bits.
 * Default ttl 86400, max 2592000.
 * Invalid resume => 401 app.err.auth.resume_invalid.
 * Refresh reuse => 401 app.err.auth.refresh_reuse and family revoked.
 */

import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';
import type { SessionStatus } from './types.js';

export const RESUME_TOKEN_RE = /^[A-Za-z0-9._~-]{16,256}$/;
export const DEFAULT_RESUME_TTL_SECONDS = 86_400;
export const MAX_RESUME_TTL_SECONDS = 2_592_000;
export const SESSION_CLOCK_SKEW_MS = 60_000;

export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function mintResumeToken(): string {
  // 32 bytes -> 256 bits entropy; base64url charset is a subset of the resume grammar.
  return `rsm_${randomBytes(32).toString('base64url')}`;
}

export function mintRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

export function mintAccessToken(): string {
  return `at_${randomBytes(24).toString('base64url')}`;
}

export function isResumeTokenFormat(token: string): boolean {
  return RESUME_TOKEN_RE.test(token);
}

export function clampResumeTtl(ttlSeconds?: number): number {
  const ttl = ttlSeconds ?? DEFAULT_RESUME_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0) return DEFAULT_RESUME_TTL_SECONDS;
  return Math.min(Math.floor(ttl), MAX_RESUME_TTL_SECONDS);
}

export function formatSetAppResume(token: string, ttlSeconds?: number): string {
  const ttl = clampResumeTtl(ttlSeconds);
  return `${token}; ttl=${ttl}`;
}

export interface SessionRecord {
  id: string;
  epoch: number;
  status: SessionStatus;
  subjectRef?: string;
  expiresAt: number;
  refreshFamilyId: string;
  createdAt: number;
}

export interface RefreshFamily {
  id: string;
  sessionId: string;
  currentTokenHash: string;
  spentHashes: Set<string>;
  revoked: boolean;
}

export interface ResumeRecord {
  tokenHash: string;
  sessionId: string;
  expiresAt: number;
  spent: boolean;
}

export interface SessionStore {
  getSession(id: string): Promise<SessionRecord | null>;
  setSession(session: SessionRecord): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getFamily(id: string): Promise<RefreshFamily | null>;
  setFamily(family: RefreshFamily): Promise<void>;
  findFamilyByTokenHash(tokenHash: string): Promise<RefreshFamily | null>;
  getResume(tokenHash: string): Promise<ResumeRecord | null>;
  setResume(record: ResumeRecord): Promise<void>;
  deleteResume(tokenHash: string): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly families = new Map<string, RefreshFamily>();
  private readonly resumes = new Map<string, ResumeRecord>();

  async getSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }
  async setSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }
  async getFamily(id: string): Promise<RefreshFamily | null> {
    return this.families.get(id) ?? null;
  }
  async setFamily(family: RefreshFamily): Promise<void> {
    this.families.set(family.id, family);
  }
  async findFamilyByTokenHash(tokenHash: string): Promise<RefreshFamily | null> {
    for (const f of this.families.values()) {
      if (f.currentTokenHash === tokenHash || f.spentHashes.has(tokenHash)) return f;
    }
    return null;
  }
  async getResume(tokenHash: string): Promise<ResumeRecord | null> {
    return this.resumes.get(tokenHash) ?? null;
  }
  async setResume(record: ResumeRecord): Promise<void> {
    this.resumes.set(record.tokenHash, record);
  }
  async deleteResume(tokenHash: string): Promise<void> {
    this.resumes.delete(tokenHash);
  }

  clear(): void {
    this.sessions.clear();
    this.families.clear();
    this.resumes.clear();
  }
}

export function isSessionExpired(session: SessionRecord, now = Date.now()): boolean {
  return now >= session.expiresAt;
}

export async function createAuthenticatedSession(
  store: SessionStore,
  opts: {
    sessionId: string;
    subjectRef?: string;
    accessTtlMs?: number;
    now?: number;
  },
): Promise<{ session: SessionRecord; refreshToken: string; family: RefreshFamily }> {
  const now = opts.now ?? Date.now();
  const familyId = `fam_${randomBytes(12).toString('base64url')}`;
  const refreshToken = mintRefreshToken();
  const session: SessionRecord = {
    id: opts.sessionId,
    epoch: 0,
    status: 'authenticated',
    subjectRef: opts.subjectRef,
    expiresAt: now + (opts.accessTtlMs ?? 3_600_000),
    refreshFamilyId: familyId,
    createdAt: now,
  };
  const family: RefreshFamily = {
    id: familyId,
    sessionId: session.id,
    currentTokenHash: hashSecret(refreshToken),
    spentHashes: new Set(),
    revoked: false,
  };
  await store.setSession(session);
  await store.setFamily(family);
  return { session, refreshToken, family };
}

export type ResumeAuthResult =
  | {
      ok: true;
      session: SessionRecord;
      /** New token when rotated (resume-alone + session_resume). */
      rotatedResume?: string;
      setAppResume?: string;
    }
  | { ok: false; error: AppError };

/**
 * Spend (and optionally rotate) a resume token.
 * Rotation MUST NOT invalidate the underlying session.
 */
export async function authenticateWithResume(
  store: SessionStore,
  opts: {
    resumeToken: string;
    sessionResumeEnabled: boolean;
    /** True when no other authenticator (cookie/bearer) succeeded. */
    resumeAlone: boolean;
    now?: number;
    ttlSeconds?: number;
  },
): Promise<ResumeAuthResult> {
  if (!isResumeTokenFormat(opts.resumeToken)) {
    return {
      ok: false,
      error: new AppError('app.err.auth.resume_invalid', { message: 'Resume token is invalid' }),
    };
  }
  const now = opts.now ?? Date.now();
  const tokenHash = hashSecret(opts.resumeToken);
  const rec = await store.getResume(tokenHash);
  if (!rec || rec.spent || now >= rec.expiresAt) {
    return {
      ok: false,
      error: new AppError('app.err.auth.resume_invalid', { message: 'Resume token is invalid' }),
    };
  }
  const session = await store.getSession(rec.sessionId);
  if (!session) {
    return {
      ok: false,
      error: new AppError('app.err.auth.resume_invalid', { message: 'Resume token is invalid' }),
    };
  }

  let rotatedResume: string | undefined;
  let setAppResume: string | undefined;
  if (opts.sessionResumeEnabled && opts.resumeAlone) {
    rec.spent = true;
    await store.setResume(rec);
    rotatedResume = mintResumeToken();
    const ttl = clampResumeTtl(opts.ttlSeconds);
    await store.setResume({
      tokenHash: hashSecret(rotatedResume),
      sessionId: session.id,
      expiresAt: now + ttl * 1000,
      spent: false,
    });
    setAppResume = formatSetAppResume(rotatedResume, ttl);
  }
  return { ok: true, session, rotatedResume, setAppResume };
}

export async function mintResume(
  store: SessionStore,
  opts: { sessionId: string; ttlSeconds?: number; now?: number },
): Promise<{ token: string; header: string; record: ResumeRecord }> {
  const now = opts.now ?? Date.now();
  const ttl = clampResumeTtl(opts.ttlSeconds);
  const token = mintResumeToken();
  const record: ResumeRecord = {
    tokenHash: hashSecret(token),
    sessionId: opts.sessionId,
    expiresAt: now + ttl * 1000,
    spent: false,
  };
  await store.setResume(record);
  return { token, header: formatSetAppResume(token, ttl), record };
}

/**
 * Rotate resume (spend old, issue new) without touching the session or refresh family.
 */
export async function rotateResume(
  store: SessionStore,
  opts: { currentToken: string; ttlSeconds?: number; now?: number },
): Promise<ResumeAuthResult> {
  return authenticateWithResume(store, {
    resumeToken: opts.currentToken,
    sessionResumeEnabled: true,
    resumeAlone: true,
    now: opts.now,
    ttlSeconds: opts.ttlSeconds,
  });
}

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string; session: SessionRecord }
  | { ok: false; error: AppError };

/**
 * Rotate refresh token. Replay of a spent token revokes the family.
 */
export async function spendRefreshToken(
  store: SessionStore,
  opts: { refreshToken: string; accessTtlMs?: number; now?: number },
): Promise<RefreshResult> {
  const now = opts.now ?? Date.now();
  const presented = hashSecret(opts.refreshToken);
  const family = await store.findFamilyByTokenHash(presented);
  if (!family) {
    return {
      ok: false,
      error: new AppError('app.err.auth.expired', { message: 'Refresh token is invalid' }),
    };
  }
  if (family.revoked) {
    return {
      ok: false,
      error: new AppError('app.err.auth.refresh_reuse', {
        message: 'Refresh token reuse detected',
      }),
    };
  }
  if (family.spentHashes.has(presented)) {
    family.revoked = true;
    if (family.currentTokenHash) family.spentHashes.add(family.currentTokenHash);
    family.currentTokenHash = '';
    await store.setFamily(family);
    const session = await store.getSession(family.sessionId);
    if (session) {
      session.status = 'expired';
      await store.setSession(session);
    }
    return {
      ok: false,
      error: new AppError('app.err.auth.refresh_reuse', {
        message: 'Refresh token reuse detected',
      }),
    };
  }
  if (family.currentTokenHash !== presented) {
    return {
      ok: false,
      error: new AppError('app.err.auth.expired', { message: 'Refresh token is invalid' }),
    };
  }

  family.spentHashes.add(presented);
  const next = mintRefreshToken();
  family.currentTokenHash = hashSecret(next);
  await store.setFamily(family);

  const session = await store.getSession(family.sessionId);
  if (!session) {
    return {
      ok: false,
      error: new AppError('app.err.auth.expired', { message: 'Session is gone' }),
    };
  }
  session.status = 'authenticated';
  session.expiresAt = now + (opts.accessTtlMs ?? 3_600_000);
  await store.setSession(session);
  return { ok: true, accessToken: mintAccessToken(), refreshToken: next, session };
}

export async function bumpSessionEpoch(store: SessionStore, sessionId: string): Promise<number> {
  const session = await store.getSession(sessionId);
  if (!session) return 0;
  session.epoch += 1;
  session.status = 'anonymous';
  await store.setSession(session);
  return session.epoch;
}

/** Look up a refresh family by presenting a token (test helper). */
export async function findFamilyByRefreshToken(
  store: SessionStore,
  refreshToken: string,
): Promise<RefreshFamily | null> {
  return store.findFamilyByTokenHash(hashSecret(refreshToken));
}
