/**
 * Human-verification hold (SPEC §7).
 * Max 3 holds per credential-identity per 10 minutes => 429 hold.rate.
 * Max 1 active hold per in-flight action; nested => 409 hold.nested.
 * complete_hold with X-APP-Client agent/* => 403 hold.invalid.
 * Hold token single-use, 60s after clear.
 * agent_solvable MUST be false for captcha/liveness.
 */

import { randomBytes } from 'node:crypto';
import { isAgentClient } from './confirmation.js';
import { AppError } from './errors.js';
import { isAllowedAppUrlScheme } from './loopback.js';
import type { HoldKind, HoldObject } from './types.js';

export const HOLD_WINDOW_MS = 10 * 60 * 1000;
export const HOLD_MAX_PER_WINDOW = 3;
export const HOLD_TOKEN_TTL_AFTER_CLEAR_MS = 60_000;
export const HOLD_TTL_DEFAULT_MS = 300_000;
export const HOLD_TTL_MIN_MS = 60_000;
export const HOLD_TTL_MAX_MS = 900_000;

export type HoldStatus = 'pending' | 'cleared' | 'expired' | 'failed';

export interface HoldRecord {
  id: string;
  kind: HoldKind;
  identityKey: string;
  actionId: string;
  verifyUrl: string;
  widgetUrl?: string;
  status: HoldStatus;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
  agentSolvable: false;
  issuedCount: number;
  token?: string;
  tokenExpiresAt?: number;
  tokenSpent?: boolean;
}

export interface HoldStore {
  get(id: string): Promise<HoldRecord | null>;
  set(record: HoldRecord): Promise<void>;
  listByIdentity(identityKey: string): Promise<HoldRecord[]>;
  getActiveForAction(actionId: string): Promise<HoldRecord | null>;
  getByToken(token: string): Promise<HoldRecord | null>;
}

export class MemoryHoldStore implements HoldStore {
  private readonly map = new Map<string, HoldRecord>();

  async get(id: string): Promise<HoldRecord | null> {
    return this.map.get(id) ?? null;
  }
  async set(record: HoldRecord): Promise<void> {
    this.map.set(record.id, record);
  }
  async listByIdentity(identityKey: string): Promise<HoldRecord[]> {
    return [...this.map.values()].filter((h) => h.identityKey === identityKey);
  }
  async getActiveForAction(actionId: string): Promise<HoldRecord | null> {
    for (const h of this.map.values()) {
      if (h.actionId === actionId && h.status === 'pending') return h;
    }
    return null;
  }
  async getByToken(token: string): Promise<HoldRecord | null> {
    for (const h of this.map.values()) {
      if (h.token === token) return h;
    }
    return null;
  }
  clear(): void {
    this.map.clear();
  }
}

export function mintHoldId(): string {
  return `hold_${randomBytes(16).toString('base64url')}`;
}

export function mintHoldToken(): string {
  return `htk_${randomBytes(16).toString('base64url')}`;
}

export function clampHoldTtl(ttlMs?: number): number {
  const ttl = ttlMs ?? HOLD_TTL_DEFAULT_MS;
  if (!Number.isFinite(ttl)) return HOLD_TTL_DEFAULT_MS;
  return Math.min(HOLD_TTL_MAX_MS, Math.max(HOLD_TTL_MIN_MS, Math.floor(ttl)));
}

function forceAgentSolvable(kind: HoldKind): false {
  void kind;
  return false;
}

export function holdToObject(record: HoldRecord): HoldObject {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    who: 'human',
    verify_url: record.verifyUrl,
    widget_url: record.widgetUrl,
    ttl_ms: record.ttlMs,
    expires_at: new Date(record.expiresAt).toISOString(),
    agent_solvable: false,
    issued_count: record.issuedCount,
  };
}

export type HoldIssueResult = { ok: true; record: HoldRecord } | { ok: false; error: AppError };

export async function issueHold(
  store: HoldStore,
  opts: {
    identityKey: string;
    actionId: string;
    kind: HoldKind;
    verifyUrl: string;
    widgetUrl?: string;
    ttlMs?: number;
    now?: number;
  },
): Promise<HoldIssueResult> {
  const now = opts.now ?? Date.now();
  if (opts.widgetUrl !== undefined && !isAllowedAppUrlScheme(opts.widgetUrl)) {
    return {
      ok: false,
      error: new AppError('app.err.hold.invalid_widget', {
        message: 'widget_url must be https (http allowed on loopback only)',
      }),
    };
  }
  const nested = await store.getActiveForAction(opts.actionId);
  if (nested) {
    return {
      ok: false,
      error: new AppError('app.err.hold.nested', {
        message: 'A hold is already active for this action',
      }),
    };
  }

  const recent = (await store.listByIdentity(opts.identityKey)).filter(
    (h) => now - h.createdAt < HOLD_WINDOW_MS,
  );
  if (recent.length >= HOLD_MAX_PER_WINDOW) {
    const oldest = recent.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    const retryAfterMs = HOLD_WINDOW_MS - (now - oldest.createdAt);
    return {
      ok: false,
      error: new AppError('app.err.hold.rate', {
        message: 'Hold rate limit exceeded',
        retry_after_ms: Math.max(0, retryAfterMs),
      }),
    };
  }

  const ttlMs = clampHoldTtl(opts.ttlMs);
  const record: HoldRecord = {
    id: mintHoldId(),
    kind: opts.kind,
    identityKey: opts.identityKey,
    actionId: opts.actionId,
    verifyUrl: opts.verifyUrl,
    widgetUrl: opts.widgetUrl,
    status: 'pending',
    createdAt: now,
    expiresAt: now + ttlMs,
    ttlMs,
    agentSolvable: forceAgentSolvable(opts.kind),
    issuedCount: recent.length + 1,
  };
  await store.set(record);
  return { ok: true, record };
}

export type HoldCompleteResult =
  { ok: true; record: HoldRecord; token: string } | { ok: false; error: AppError };

/**
 * complete_hold. Agents (X-APP-Client: agent/*) MUST be rejected with hold.invalid.
 * On success, issues a single-use hold token with TTL min(remaining, 60s).
 */
export async function completeHold(
  store: HoldStore,
  opts: {
    holdId: string;
    clientHeader?: string | null;
    now?: number;
  },
): Promise<HoldCompleteResult> {
  if (isAgentClient(opts.clientHeader)) {
    return {
      ok: false,
      error: new AppError('app.err.hold.invalid', { message: 'Agents MUST NOT complete holds' }),
    };
  }
  const now = opts.now ?? Date.now();
  const record = await store.get(opts.holdId);
  if (!record) {
    return {
      ok: false,
      error: new AppError('app.err.hold.invalid', { message: 'Hold is invalid' }),
    };
  }
  if (now >= record.expiresAt || record.status === 'expired') {
    record.status = 'expired';
    await store.set(record);
    return { ok: false, error: new AppError('app.err.hold.expired', { message: 'Hold expired' }) };
  }
  if (record.status !== 'pending') {
    return {
      ok: false,
      error: new AppError('app.err.hold.invalid', { message: 'Hold is not pending' }),
    };
  }
  const remaining = record.expiresAt - now;
  const tokenTtl = Math.min(HOLD_TOKEN_TTL_AFTER_CLEAR_MS, Math.max(0, remaining));
  record.status = 'cleared';
  record.token = mintHoldToken();
  record.tokenExpiresAt = now + tokenTtl;
  record.tokenSpent = false;
  await store.set(record);
  return { ok: true, record, token: record.token };
}

export type HoldTokenResult = { ok: true; record: HoldRecord } | { ok: false; error: AppError };

export async function spendHoldToken(
  store: HoldStore,
  opts: { token: string; now?: number },
): Promise<HoldTokenResult> {
  const now = opts.now ?? Date.now();
  const record = await store.getByToken(opts.token);
  if (!record) {
    return {
      ok: false,
      error: new AppError('app.err.hold.invalid', { message: 'Hold token is invalid' }),
    };
  }
  if (record.tokenSpent) {
    return {
      ok: false,
      error: new AppError('app.err.hold.invalid', { message: 'Hold token already used' }),
    };
  }
  if (!record.tokenExpiresAt || now >= record.tokenExpiresAt) {
    return {
      ok: false,
      error: new AppError('app.err.hold.expired', { message: 'Hold token expired' }),
    };
  }
  record.tokenSpent = true;
  await store.set(record);
  return { ok: true, record };
}

export async function expireHold(store: HoldStore, id: string, now = Date.now()): Promise<void> {
  const record = await store.get(id);
  if (!record) return;
  if (now >= record.expiresAt && record.status === 'pending') {
    record.status = 'expired';
    await store.set(record);
  }
}

export async function clearHold(
  store: HoldStore,
  id: string,
  now = Date.now(),
): Promise<HoldCompleteResult> {
  return completeHold(store, { holdId: id, now });
}
