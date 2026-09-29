/**
 * 428 continuation (X-APP-Challenge, SPEC §18.2 key reuse);
 * page-step submit_otp; unattended timeout (CLIENT-TOOL-CONTRACT §6.4).
 */

import { AppError, type AppHttpClient, type PageManifest } from '@agent-page/client';
import { HEADER_APP_CHALLENGE, type HoldFile } from './types.js';
import { decodeRawBodyString, HoldStore, isUuidModeToken, type PersistHoldInput } from './holds.js';

export interface ChallengeDetails {
  id: string;
  kind: string;
  param: string;
  ttl_ms?: number;
  expires_at?: string;
  attempts_remaining?: number;
  poll_interval_ms?: number;
  channel?: string;
}

function nodeValue(v: unknown): unknown {
  if (v && typeof v === 'object' && 'type' in (v as object) && 'value' in (v as object)) {
    return (v as { value: unknown }).value;
  }
  return v;
}

function asObject(v: unknown): Record<string, unknown> | null {
  const inner = nodeValue(v);
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && !('type' in (v as object))) {
    return v as Record<string, unknown>;
  }
  return null;
}

/** Extract details.challenge from a 428 envelope / AppError. */
export function extractChallenge(err: {
  envelope?: { error?: { details?: Record<string, unknown>; confirmation_challenge?: string } };
  details?: Record<string, unknown>;
}): ChallengeDetails | null {
  const details =
    err.envelope?.error?.details ??
    (err as { envelope?: { error?: { details?: Record<string, unknown> } } }).envelope?.error
      ?.details ??
    err.details;
  if (!details || typeof details !== 'object') return null;
  const obj = asObject(details.challenge);
  if (!obj) return null;
  const id = nodeValue(obj.id);
  if (typeof id !== 'string' || !id) return null;
  const kind = typeof nodeValue(obj.kind) === 'string' ? String(nodeValue(obj.kind)) : 'otp';
  const param = typeof nodeValue(obj.param) === 'string' ? String(nodeValue(obj.param)) : 'otp';
  const ttl = nodeValue(obj.ttl_ms);
  const attempts = nodeValue(obj.attempts_remaining);
  const expires = nodeValue(obj.expires_at);
  const poll = nodeValue(obj.poll_interval_ms);
  return {
    id,
    kind,
    param,
    ttl_ms: typeof ttl === 'number' ? ttl : undefined,
    expires_at: typeof expires === 'string' ? expires : undefined,
    attempts_remaining: typeof attempts === 'number' ? attempts : undefined,
    poll_interval_ms: typeof poll === 'number' ? poll : undefined,
    channel:
      typeof nodeValue(obj.channel) === 'string' ? String(nodeValue(obj.channel)) : undefined,
  };
}

export function holdKindForChallenge(kind: string): 'otp' | 'mfa' {
  if (kind === 'otp' || kind === 'totp' || kind === 'backup_code') return 'otp';
  return 'mfa';
}

export function isPageStepOtp(manifest: PageManifest): boolean {
  return !!manifest.actions?.submit_otp;
}

/**
 * Rebuild original Action Request JSON, add only the challenge param, keep action id.
 * SPEC §18.2: the only allowed body mutation under a reused idempotency key.
 */
export function buildContinuationRawBody(
  originalRaw: string,
  param: string,
  value: string,
): string {
  const parsed = JSON.parse(originalRaw) as {
    params?: Record<string, unknown>;
    [k: string]: unknown;
  };
  const params = { ...(parsed.params ?? {}) };
  params[param] = value;
  parsed.params = params;
  return JSON.stringify(parsed);
}

export function continuationMutatedOnlyOtp(
  originalRaw: string,
  continuationRaw: string,
  param: string,
): boolean {
  const a = JSON.parse(originalRaw) as { params?: Record<string, unknown>; action?: string };
  const b = JSON.parse(continuationRaw) as { params?: Record<string, unknown>; action?: string };
  if (a.action !== b.action) return false;
  const aParams = { ...(a.params ?? {}) };
  const bParams = { ...(b.params ?? {}) };
  const extra = Object.keys(bParams).filter((k) => !(k in aParams) || aParams[k] !== bParams[k]);
  if (extra.length !== 1 || extra[0] !== param) return false;
  for (const k of Object.keys(aParams)) {
    if (k === param) continue;
    if (aParams[k] !== bParams[k]) return false;
  }
  return true;
}

export function persistChallengeHold(
  holds: HoldStore,
  input: Omit<PersistHoldInput, 'kind'> & { challengeDetails: ChallengeDetails },
): HoldFile {
  const d = input.challengeDetails;
  return holds.persist({
    ...input,
    kind: holdKindForChallenge(d.kind),
    challenge: d.id,
    challenge_param: d.param,
    attempts_remaining: d.attempts_remaining,
    ttl_ms: d.ttl_ms,
    expires_at: d.expires_at ?? input.expires_at,
    challenge_kind: d.kind,
  });
}

export function checkChallengeUnattended(file: HoldFile, now = Date.now()): void {
  const exp = Date.parse(file.expires_at);
  if (Number.isFinite(exp) && now >= exp) {
    throw new AppError('app.err.auth.challenge_unattended', {
      message: 'No challenge completion within ttl_ms',
    });
  }
}

export interface SubmitChallengeOptions {
  value?: string;
  kind: 'mfa' | 'otp';
  now?: number;
}

/**
 * Inline 428 continuation: reuse idempotency key, add only otp param, send X-APP-Challenge.
 */
export async function submitChallengeContinuation(
  http: AppHttpClient,
  holds: HoldStore,
  sessionId: string,
  opts: SubmitChallengeOptions,
): Promise<{
  file: HoldFile;
  rawBody: string;
  result: Awaited<ReturnType<AppHttpClient['postAction']>>;
}> {
  const file = holds.load(sessionId);
  if (!file) {
    throw new AppError('app.err.tool.hold_mismatch', {
      message: 'challenge submit with no hold',
    });
  }
  const earliest = file.gates.find((g) => g.status === 'pending');
  if (!earliest || earliest.kind !== 'challenge') {
    const order = file.gates
      .filter((g) => g.status === 'pending')
      .map((g) => g.kind)
      .join(' -> ');
    throw new AppError('app.err.tool.hold_mismatch', {
      message: `Pending gate order: ${order || '(none)'}. Earliest uncleared is ${earliest?.kind ?? 'none'}, not challenge.`,
    });
  }
  checkChallengeUnattended(file, opts.now ?? Date.now());
  if (isUuidModeToken(file.challenge)) {
    throw new AppError('app.err.action.confirmation_invalid', {
      message: 'Agents must not use Mode B uuid-mode confirmation',
    });
  }

  const param = file.challenge_param ?? 'otp';
  const original = decodeRawBodyString(file.raw_body_b64);
  let rawBody = original;
  if (opts.kind === 'otp' || file.kind === 'otp') {
    if (!opts.value) {
      throw new AppError('app.err.tool.usage', {
        message: '--value required for otp/totp/backup_code',
      });
    }
    rawBody = buildContinuationRawBody(original, param, opts.value);
  }

  const result = await http.postAction(file.post_url, null, {
    pageUrl: file.page_url,
    ifMatchVersion: file.if_match_version ?? file.page_version,
    idempotencyKey: file.idempotency_key ?? undefined,
    extraHeaders: {
      [HEADER_APP_CHALLENGE]: file.challenge ?? earliest.challenge ?? '',
    },
    rawBody,
  });
  return { file, rawBody, result };
}

export function applyChallengeFailure(
  holds: HoldStore,
  sessionId: string,
  code: string,
): HoldFile | null {
  const file = holds.load(sessionId);
  if (code === 'app.err.auth.challenge_failed') {
    if (!file) return null;
    const remaining =
      typeof file.attempts_remaining === 'number'
        ? Math.max(0, file.attempts_remaining - 1)
        : file.attempts_remaining;
    const next: HoldFile = { ...file, attempts_remaining: remaining };
    holds.writeFile(sessionId, next);
    return next;
  }
  if (code === 'app.err.auth.challenge_expired' || code === 'app.err.auth.challenge_invalid') {
    holds.delete(sessionId, file?.body_sha256);
    return null;
  }
  return file;
}

export function nestedChallengeExceeded(
  distinctKinds: string[],
  declaredStepCount?: number,
): boolean {
  const cap = declaredStepCount && declaredStepCount > 0 ? Math.min(3, declaredStepCount) : 2;
  return new Set(distinctKinds).size > cap;
}
