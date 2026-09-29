/**
 * OAuth/OIDC slot bind (SPEC §4.9).
 * GET callback MUST NOT exchange the authorization code.
 * complete_oauth mutate performs token exchange.
 * Replay => 409 oauth_code_spent.
 * PKCE is server-side; tokens never appear in JSON bodies.
 */

import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';
import { identityCacheHeaders, rotateSessionId } from './identity.js';

export const OAUTH_SLOT_TTL_MS = 60_000;

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

export interface OAuthSlot {
  id: string;
  provider: string;
  code: string;
  state: string;
  pkceVerifier: string;
  sessionCookieId?: string;
  createdAt: number;
  expiresAt: number;
  spent: boolean;
  exchanged: boolean;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  accessTokenTtl: number;
}

export interface OAuthStore {
  get(id: string): Promise<OAuthSlot | null>;
  getByState(state: string): Promise<OAuthSlot | null>;
  set(slot: OAuthSlot): Promise<void>;
}

export class MemoryOAuthStore implements OAuthStore {
  private readonly byId = new Map<string, OAuthSlot>();
  private readonly byState = new Map<string, string>();

  async get(id: string): Promise<OAuthSlot | null> {
    return this.byId.get(id) ?? null;
  }
  async getByState(state: string): Promise<OAuthSlot | null> {
    const id = this.byState.get(state);
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }
  async set(slot: OAuthSlot): Promise<void> {
    this.byId.set(slot.id, slot);
    this.byState.set(slot.state, slot.id);
  }
  clear(): void {
    this.byId.clear();
    this.byState.clear();
  }
}

export function mintOAuthSlotId(): string {
  return `oas_${randomBytes(16).toString('base64url')}`;
}

export function mintOAuthState(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * GET callback: bind `code` to a one-time slot. MUST NOT exchange.
 * Manifest MUST NOT include code, id_token, or access token.
 */
export async function bindOAuthCallback(
  store: OAuthStore,
  opts: {
    provider: string;
    code: string;
    state: string;
    expectedState?: string;
    pkceVerifier: string;
    sessionCookieId?: string;
    now?: number;
  },
): Promise<{ slot: OAuthSlot; bodySafe: true }> {
  if (opts.expectedState !== undefined && opts.expectedState !== opts.state) {
    throw new AppError('app.err.security.csrf', { message: 'OAuth state mismatch' });
  }
  const now = opts.now ?? Date.now();
  const slot: OAuthSlot = {
    id: mintOAuthSlotId(),
    provider: opts.provider,
    code: opts.code,
    state: opts.state,
    pkceVerifier: opts.pkceVerifier,
    sessionCookieId: opts.sessionCookieId,
    createdAt: now,
    expiresAt: now + OAUTH_SLOT_TTL_MS,
    spent: false,
    exchanged: false,
  };
  await store.set(slot);
  return { slot, bodySafe: true };
}

export interface CompleteOAuthResult {
  sessionId: string;
  tokens: OAuthTokenSet;
  headers: Record<string, string>;
}

/**
 * complete_oauth mutate: perform token exchange using the slot (and server-side PKCE).
 * Replay after spent without stored idempotent success => 409 oauth_code_spent.
 * Tokens are returned as headers, never in the body.
 */
export async function completeOAuth(
  store: OAuthStore,
  opts: {
    slotId?: string;
    state?: string;
    now?: number;
    exchange: (slot: OAuthSlot) => Promise<OAuthTokenSet>;
  },
): Promise<CompleteOAuthResult> {
  const now = opts.now ?? Date.now();
  const slot = opts.slotId
    ? await store.get(opts.slotId)
    : opts.state
      ? await store.getByState(opts.state)
      : null;
  if (!slot) {
    throw new AppError('app.err.auth.oauth_code_spent', {
      message: 'OAuth slot is missing or spent',
    });
  }
  if (slot.spent || slot.exchanged) {
    throw new AppError('app.err.auth.oauth_code_spent', {
      message: 'Authorization code already spent',
    });
  }
  if (now >= slot.expiresAt) {
    slot.spent = true;
    await store.set(slot);
    throw new AppError('app.err.auth.oauth_code_spent', { message: 'Authorization code expired' });
  }
  const tokens = await opts.exchange(slot);
  slot.spent = true;
  slot.exchanged = true;
  await store.set(slot);

  const headers: Record<string, string> = {
    ...identityCacheHeaders(),
    'X-APP-Access-Token': tokens.accessToken,
    'X-APP-Access-Token-TTL': String(tokens.accessTokenTtl),
  };
  if (tokens.refreshToken) {
    headers['X-APP-Refresh-Token'] = tokens.refreshToken;
  }
  return {
    sessionId: rotateSessionId(slot.sessionCookieId),
    tokens,
    headers,
  };
}

/** Filter a JSON-like body so code/tokens never leak into a Page Manifest. */
export function assertNoOAuthSecretsInBody(body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  if (
    /"access_token"\s*:/i.test(text) ||
    /"id_token"\s*:/i.test(text) ||
    /"refresh_token"\s*:/i.test(text)
  ) {
    throw new AppError('app.err.internal.server', {
      message: 'OAuth tokens MUST NOT appear in JSON bodies',
    });
  }
}
