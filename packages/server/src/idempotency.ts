/**
 * Idempotency store — 24h TTL; fingerprint = SHA-256(method\\nrequest-target\\nactionId\\nrawBody).
 * Same key + same fingerprint = byte-equal replay; different fingerprint = 409 conflict;
 * in-flight = 409 action.conflict retryable. Scoped by credential-identity + key.
 * SPEC §6.7.
 */

import { createHash } from 'node:crypto';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyRecord {
  key: string;
  /** Full request fingerprint (hex SHA-256). */
  bodyHash: string;
  /** Serialized response to replay (status + headers + body). Absent while in-flight. */
  response?: StoredResponse;
  inFlight: boolean;
  createdAt: number;
  expiresAt: number;
  /** Challenge id bound to this key when a 428 challenge_required was stored (§18.2). */
  challengeId?: string;
  /** True after one successful challenge continuation completed this key (K3 MF-4). */
  successfulChallengeContinuation?: boolean;
  /** Raw body bytes of the request that issued the stored challenge (utf8). */
  challengeBaseBody?: string;
}

export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface IdempotencyLookupResult {
  type: 'miss' | 'replay' | 'conflict' | 'in_flight';
  record?: IdempotencyRecord;
}

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  set(scope: string, key: string, record: IdempotencyRecord): Promise<void>;
  delete?(scope: string, key: string): Promise<void>;
}

/** In-memory store suitable for single-process / tests. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, IdempotencyRecord>();

  private k(scope: string, key: string): string {
    return `${scope}::${key}`;
  }

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const rec = this.map.get(this.k(scope, key));
    if (!rec) return null;
    if (Date.now() > rec.expiresAt) {
      this.map.delete(this.k(scope, key));
      return null;
    }
    return rec;
  }

  async set(scope: string, key: string, record: IdempotencyRecord): Promise<void> {
    this.map.set(this.k(scope, key), record);
  }

  async delete(scope: string, key: string): Promise<void> {
    this.map.delete(this.k(scope, key));
  }

  /** Test helper */
  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Fingerprint = SHA-256(method + "\\n" + request-target + "\\n" + actionId + "\\n" + exact raw body bytes).
 */
export function computeIdempotencyFingerprint(
  method: string,
  requestTarget: string,
  actionId: string,
  rawBody: Buffer | string,
): string {
  const bodyBuf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const prefix = `${method.toUpperCase()}\n${requestTarget}\n${actionId}\n`;
  return createHash('sha256').update(prefix, 'utf8').update(bodyBuf).digest('hex');
}

/**
 * Hash exact raw body bytes (no re-serialization). Prefer computeIdempotencyFingerprint for §6.7.
 */
export function hashRequestBody(rawBody: Buffer | string | unknown): string {
  if (Buffer.isBuffer(rawBody) || typeof rawBody === 'string') {
    const buf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    return createHash('sha256').update(buf).digest('hex');
  }
  // Legacy fallback for callers still passing parsed objects — uses stable JSON bytes.
  // Prefer passing exact raw bytes.
  return createHash('sha256').update(JSON.stringify(rawBody), 'utf8').digest('hex');
}

export async function lookupIdempotency(
  store: IdempotencyStore,
  scope: string,
  key: string,
  fingerprint: string,
): Promise<IdempotencyLookupResult> {
  const existing = await store.get(scope, key);
  if (!existing) return { type: 'miss' };
  if (existing.bodyHash !== fingerprint) {
    return { type: 'conflict', record: existing };
  }
  if (existing.inFlight || !existing.response) {
    return { type: 'in_flight', record: existing };
  }
  return { type: 'replay', record: existing };
}

/** Mark a key as in-flight before dispatch. */
export async function beginIdempotentRequest(
  store: IdempotencyStore,
  scope: string,
  key: string,
  fingerprint: string,
  ttlMs = IDEMPOTENCY_TTL_MS,
): Promise<IdempotencyRecord> {
  const now = Date.now();
  const record: IdempotencyRecord = {
    key,
    bodyHash: fingerprint,
    inFlight: true,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  await store.set(scope, key, record);
  return record;
}

export async function storeIdempotentResponse(
  store: IdempotencyStore,
  scope: string,
  key: string,
  fingerprint: string,
  response: StoredResponse,
  ttlMs = IDEMPOTENCY_TTL_MS,
): Promise<IdempotencyRecord> {
  const now = Date.now();
  const existing = await store.get(scope, key);
  const challengeId = extractChallengeId(response) ?? existing?.challengeId;
  const terminalSuccess = response.status >= 200 && response.status < 300;
  const record: IdempotencyRecord = {
    key,
    bodyHash: fingerprint,
    response,
    inFlight: false,
    createdAt: existing?.createdAt ?? now,
    expiresAt: now + ttlMs,
    challengeId,
    challengeBaseBody: existing?.challengeBaseBody,
    successfulChallengeContinuation:
      existing?.successfulChallengeContinuation === true ||
      (Boolean(existing?.challengeId) && terminalSuccess),
  };
  await store.set(scope, key, record);
  return record;
}

function extractChallengeId(response: StoredResponse): string | undefined {
  const body = response.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const rec = body as { error?: { code?: string; details?: Record<string, { value?: unknown }> } };
  if (rec.error?.code !== 'app.err.auth.challenge_required') return undefined;
  return challengeIdFromErrorDetails(rec.error.details);
}

/** Stored response is an app.err.auth.challenge_failed envelope. */
function recordChallengeFailed(response: StoredResponse | undefined): boolean {
  const body = response?.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return (body as { error?: { code?: string } }).error?.code === 'app.err.auth.challenge_failed';
}

/**
 * §18.2 challenge id inside an error envelope's `details`.
 * Canonical shape is an object node: `challenge.value.id.value`.
 * Also accepted: `challenge.value` as a plain string, or `details.id` as a
 * string node — emitters that carry the id directly.
 */
export function challengeIdFromErrorDetails(
  details: Record<string, unknown> | undefined,
): string | undefined {
  const node = details?.challenge ?? details?.id;
  const value = node && typeof node === 'object' ? (node as { value?: unknown }).value : undefined;
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as { id?: { value?: unknown } }).id?.value;
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

const DEFAULT_CHALLENGE_PARAMS = ['otp', 'credential'];

/**
 * True when `nextBody` is `prevBody` JSON plus only advertised challenge params (§18.2).
 */
export function isChallengeContinuationBody(
  prevRaw: Buffer | string,
  nextRaw: Buffer | string,
  challengeParams: string[] = DEFAULT_CHALLENGE_PARAMS,
): boolean {
  let prev: unknown;
  let next: unknown;
  try {
    prev = JSON.parse(typeof prevRaw === 'string' ? prevRaw : prevRaw.toString('utf8'));
    next = JSON.parse(typeof nextRaw === 'string' ? nextRaw : nextRaw.toString('utf8'));
  } catch {
    return false;
  }
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return false;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  if (p.action !== n.action) return false;
  const prevParams =
    p.params && typeof p.params === 'object' && !Array.isArray(p.params)
      ? (p.params as Record<string, unknown>)
      : {};
  const nextParams =
    n.params && typeof n.params === 'object' && !Array.isArray(n.params)
      ? (n.params as Record<string, unknown>)
      : {};
  for (const [k, v] of Object.entries(prevParams)) {
    if (challengeParams.includes(k)) continue;
    if (JSON.stringify(nextParams[k]) !== JSON.stringify(v)) return false;
  }
  for (const k of Object.keys(nextParams)) {
    if (k in prevParams) continue;
    if (!challengeParams.includes(k)) return false;
  }
  return true;
}

export type ChallengeContinuationDecision =
  { type: 'not_continuation' } | { type: 'continue'; challengeId: string } | { type: 'invalid' };

/**
 * K3 MF-4 / §18.2: at most one successful challenge continuation per key K.
 */
export function evaluateChallengeContinuation(options: {
  record: IdempotencyRecord;
  selectedVersion: string;
  challengeHeader: string | undefined | null;
  newRawBody: Buffer | string;
}): ChallengeContinuationDecision {
  const { record, selectedVersion, challengeHeader, newRawBody } = options;
  if (selectedVersion !== '1.1') return { type: 'not_continuation' };
  if (!challengeHeader) return { type: 'not_continuation' };

  const storedStatus = record.response?.status;
  const storedIsChallenge =
    (storedStatus === 428 && Boolean(extractChallengeId(record.response!))) ||
    // §18.2: a challenge_failed response keeps the same challenge alive —
    // the binding (challengeId/base body) outlives the failed attempt.
    (storedStatus === 401 &&
      Boolean(record.challengeId) &&
      Boolean(record.challengeBaseBody) &&
      recordChallengeFailed(record.response));
  const storedTerminal =
    typeof storedStatus === 'number' && storedStatus >= 200 && storedStatus < 300;

  if (record.successfulChallengeContinuation || storedTerminal) {
    return { type: 'invalid' };
  }
  if (!storedIsChallenge || !record.challengeId) {
    return { type: 'invalid' };
  }
  if (challengeHeader !== record.challengeId) {
    return { type: 'invalid' };
  }
  const base = record.challengeBaseBody;
  if (!base) return { type: 'not_continuation' };
  if (!isChallengeContinuationBody(base, newRawBody)) {
    return { type: 'not_continuation' };
  }
  return { type: 'continue', challengeId: record.challengeId };
}

/** Bind the original body that produced a challenge_required so continuation can be verified. */
export async function bindChallengeBaseBody(
  store: IdempotencyStore,
  scope: string,
  key: string,
  rawBody: Buffer | string,
  challengeId: string,
): Promise<void> {
  const existing = await store.get(scope, key);
  if (!existing) return;
  existing.challengeId = challengeId;
  existing.challengeBaseBody = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  await store.set(scope, key, existing);
}

/**
 * Scope by credential-identity (§6.7#7). Key alone is insufficient across users.
 * Optionally include pageId for operational isolation within an identity.
 */
export function idempotencyScope(credentialIdentity: string, pageId?: string): string {
  if (pageId) return `${credentialIdentity}|${pageId}`;
  return credentialIdentity || 'anon';
}
