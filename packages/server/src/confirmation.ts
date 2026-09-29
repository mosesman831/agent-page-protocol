/**
 * Confirmation challenge-echo tokens (§10.4 / C10).
 * Bound to action + SHA-256(exact raw request body bytes) + page.version + credential-identity.
 * Single-use, 300s TTL. Mode B uuid-mode rejected for agent clients.
 */

import { createHash, randomBytes } from 'node:crypto';

export const CONFIRMATION_TTL_MS = 300_000;
export const CONFIRMATION_CLOCK_SKEW_MS = 60_000;
export const UUID_MODE_PREFIX = 'uuid-mode:';

export interface ConfirmationBinding {
  token: string;
  actionId: string;
  /** Hex SHA-256 of exact raw request body bytes (C10). */
  bodySha256: string;
  pageVersion: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  mode: 'challenge' | 'uuid';
}

export interface ConfirmationStore {
  get(token: string): Promise<ConfirmationBinding | null>;
  set(binding: ConfirmationBinding): Promise<void>;
  markUsed(token: string): Promise<void>;
}

export class MemoryConfirmationStore implements ConfirmationStore {
  private readonly map = new Map<string, ConfirmationBinding>();

  async get(token: string): Promise<ConfirmationBinding | null> {
    const b = this.map.get(token);
    if (!b) return null;
    if (Date.now() > b.expiresAt) {
      this.map.delete(token);
      return null;
    }
    return b;
  }

  async set(binding: ConfirmationBinding): Promise<void> {
    this.map.set(binding.token, binding);
  }

  async markUsed(token: string): Promise<void> {
    const b = this.map.get(token);
    if (b) {
      b.used = true;
      this.map.set(token, b);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export function sha256Hex(rawBody: Buffer | string): string {
  const buf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  return createHash('sha256').update(buf).digest('hex');
}

export function generateChallengeToken(): string {
  return `conf_${randomBytes(24).toString('base64url')}`;
}

function isUuidModeToken(token: string): boolean {
  return token.startsWith(UUID_MODE_PREFIX);
}

function parseClientKind(clientHeader: string | null | undefined): string | null {
  if (!clientHeader) return null;
  // Forms: "agent/name", "agent", "renderer/ext", etc.
  const slash = clientHeader.indexOf('/');
  const kind = (slash >= 0 ? clientHeader.slice(0, slash) : clientHeader).trim().toLowerCase();
  return kind || null;
}

export function isAgentClient(clientHeader: string | null | undefined): boolean {
  return parseClientKind(clientHeader) === 'agent';
}

export async function issueConfirmationChallenge(
  store: ConfirmationStore,
  opts: {
    actionId: string;
    rawBody: Buffer | string;
    pageVersion: string;
    sessionId: string;
    ttlMs?: number;
  },
): Promise<ConfirmationBinding> {
  const token = generateChallengeToken();
  const now = Date.now();
  const binding: ConfirmationBinding = {
    token,
    actionId: opts.actionId,
    bodySha256: sha256Hex(opts.rawBody),
    pageVersion: opts.pageVersion,
    sessionId: opts.sessionId,
    createdAt: now,
    expiresAt: now + (opts.ttlMs ?? CONFIRMATION_TTL_MS),
    used: false,
    mode: 'challenge',
  };
  await store.set(binding);
  return binding;
}

/**
 * Bind a Mode B uuid-mode token on first presentation (renderer/extension sessions only).
 */
export async function bindUuidModeConfirmation(
  store: ConfirmationStore,
  opts: {
    token: string;
    actionId: string;
    rawBody: Buffer | string;
    pageVersion: string;
    sessionId: string;
    ttlMs?: number;
  },
): Promise<ConfirmationBinding> {
  const uuid = opts.token.slice(UUID_MODE_PREFIX.length);
  if (!uuid || uuid.length < 8) {
    throw new Error('Invalid uuid-mode token');
  }
  const now = Date.now();
  const binding: ConfirmationBinding = {
    token: opts.token,
    actionId: opts.actionId,
    bodySha256: sha256Hex(opts.rawBody),
    pageVersion: opts.pageVersion,
    sessionId: opts.sessionId,
    createdAt: now,
    expiresAt: now + (opts.ttlMs ?? CONFIRMATION_TTL_MS),
    used: false,
    mode: 'uuid',
  };
  await store.set(binding);
  return binding;
}

export type ConfirmationVerifyResult =
  | { ok: true; binding: ConfirmationBinding }
  | {
      ok: false;
      reason:
        | 'missing'
        | 'unknown'
        | 'expired'
        | 'used'
        | 'action_mismatch'
        | 'body_mismatch'
        | 'version_mismatch'
        | 'session_mismatch'
        | 'agent_uuid_mode';
    };

export async function verifyConfirmation(
  store: ConfirmationStore,
  opts: {
    token: string | null | undefined;
    actionId: string;
    rawBody: Buffer | string;
    pageVersion: string;
    sessionId: string;
    /** X-APP-Client header value. */
    clientHeader?: string | null;
  },
): Promise<ConfirmationVerifyResult> {
  if (!opts.token) {
    return { ok: false, reason: 'missing' };
  }

  if (isUuidModeToken(opts.token)) {
    if (isAgentClient(opts.clientHeader)) {
      return { ok: false, reason: 'agent_uuid_mode' };
    }
    let binding = await store.get(opts.token);
    if (!binding) {
      // First presentation: bind atomically to the request tuple.
      binding = await bindUuidModeConfirmation(store, {
        token: opts.token,
        actionId: opts.actionId,
        rawBody: opts.rawBody,
        pageVersion: opts.pageVersion,
        sessionId: opts.sessionId,
      });
      return { ok: true, binding };
    }
    return verifyBinding(binding, opts);
  }

  const binding = await store.get(opts.token);
  if (!binding) {
    return { ok: false, reason: 'unknown' };
  }
  return verifyBinding(binding, opts);
}

function verifyBinding(
  binding: ConfirmationBinding,
  opts: {
    actionId: string;
    rawBody: Buffer | string;
    pageVersion: string;
    sessionId: string;
  },
): ConfirmationVerifyResult {
  if (binding.used) {
    return { ok: false, reason: 'used' };
  }
  if (Date.now() > binding.expiresAt + CONFIRMATION_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'expired' };
  }
  if (Date.now() > binding.expiresAt) {
    // Within skew window after expiry still reject as expired for security.
    return { ok: false, reason: 'expired' };
  }
  if (binding.actionId !== opts.actionId) {
    return { ok: false, reason: 'action_mismatch' };
  }
  if (binding.pageVersion !== opts.pageVersion) {
    return { ok: false, reason: 'version_mismatch' };
  }
  if (binding.sessionId !== opts.sessionId) {
    return { ok: false, reason: 'session_mismatch' };
  }
  const bodyHash = sha256Hex(opts.rawBody);
  if (bodyHash !== binding.bodySha256) {
    return { ok: false, reason: 'body_mismatch' };
  }
  return { ok: true, binding };
}

/** Consume (single-use) after successful verification. */
export async function consumeConfirmation(store: ConfirmationStore, token: string): Promise<void> {
  await store.markUsed(token);
}

/** Deterministic fingerprint for logging (not the token itself). */
export function confirmationFingerprint(binding: ConfirmationBinding): string {
  return createHash('sha256')
    .update(
      `${binding.actionId}|${binding.bodySha256}|${binding.pageVersion}|${binding.sessionId}`,
      'utf8',
    )
    .digest('hex')
    .slice(0, 16);
}
