/**
 * MFA / OTP challenge state machine (SPEC-v0.5-extreme §6, §25.1).
 * Unattended after ttl_ms -> app.err.auth.challenge_unattended. No busy loop.
 */

import { AppError } from './errors.js';
import { isStateNode, readNumberNode, readStringNode, unwrapStateNode } from './features.js';
import type { ChallengeKind, ChallengeObject, PageManifest, StateNode } from './types.js';

export interface ChallengeRequest {
  challenge: ChallengeObject;
  actionId: string;
  params: Record<string, unknown>;
  manifest: PageManifest;
}

export type OnChallenge = (
  req: ChallengeRequest,
) => Promise<{ otp?: string; credential?: object; abort?: boolean }>;

const MAX_FACTOR_STEPS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function nodeMap(node: unknown): Record<string, unknown> | null {
  if (isStateNode(node) && node.type === 'object') {
    return ((node as { value?: Record<string, StateNode> }).value ?? {}) as Record<string, unknown>;
  }
  if (node && typeof node === 'object' && !('type' in (node as object))) {
    return node as Record<string, unknown>;
  }
  const unwrapped = unwrapStateNode(node);
  if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
    return unwrapped as Record<string, unknown>;
  }
  return null;
}

export function parseChallengeObject(node: unknown): ChallengeObject | null {
  const map = nodeMap(node);
  if (!map) return null;
  const id = readStringNode(map.id) ?? (typeof map.id === 'string' ? map.id : undefined);
  const kind = (readStringNode(map.kind) ??
    (typeof map.kind === 'string' ? map.kind : undefined)) as ChallengeKind | undefined;
  if (!id || !kind) return null;
  const challenge: ChallengeObject = { id, kind };
  const channel = (readStringNode(map.channel) ??
    (typeof map.channel === 'string' ? map.channel : undefined)) as
    ChallengeObject['channel'] | undefined;
  if (channel) challenge.channel = channel;
  const param =
    readStringNode(map.param) ?? (typeof map.param === 'string' ? map.param : undefined);
  if (param) challenge.param = param;
  const maxAttempts = readNumberNode(map.max_attempts);
  if (maxAttempts !== undefined) challenge.max_attempts = maxAttempts;
  const mask = readStringNode(map.mask);
  if (mask) challenge.mask = mask;
  const codeLen = readNumberNode(map.length);
  if (codeLen !== undefined) challenge.length = codeLen;
  const resendAt = readStringNode(map.resend_available_at);
  if (resendAt) challenge.resend_available_at = resendAt;
  const resendAction = readStringNode(map.resend_action);
  if (resendAction) challenge.resend_action = resendAction;
  const minLen = readNumberNode(map.min_length) ?? readNumberNode(map.length);
  if (minLen !== undefined) challenge.min_length = minLen;
  const maxLen = readNumberNode(map.max_length) ?? readNumberNode(map.length);
  if (maxLen !== undefined) challenge.max_length = maxLen;
  const pattern = readStringNode(map.pattern);
  if (pattern) challenge.pattern = pattern;
  const ttl = readNumberNode(map.ttl_ms);
  if (ttl !== undefined) challenge.ttl_ms = ttl;
  const expires = readStringNode(map.expires_at);
  if (expires) challenge.expires_at = expires;
  const attempts = readNumberNode(map.attempts_remaining);
  if (attempts !== undefined) challenge.attempts_remaining = attempts;
  const poll = readNumberNode(map.poll_interval_ms);
  if (poll !== undefined) challenge.poll_interval_ms = poll;
  const pk = map.public_key;
  if (pk && typeof pk === 'object') {
    const unwrapped = unwrapStateNode(pk);
    if (unwrapped && typeof unwrapped === 'object') {
      challenge.public_key = unwrapped as Record<string, unknown>;
    }
  }
  return challenge;
}

export function challengeFromErrorDetails(
  details: Record<string, StateNode> | undefined,
): ChallengeObject | null {
  if (!details) return null;
  return parseChallengeObject(details.challenge);
}

export function challengeFromManifest(manifest: PageManifest): ChallengeObject | null {
  return parseChallengeObject(manifest.state?.challenge);
}

export function challengeTtlMs(challenge: ChallengeObject, serverTime?: string): number {
  if (challenge.expires_at) {
    const exp = Date.parse(challenge.expires_at);
    if (!Number.isNaN(exp)) {
      const now = serverTime ? Date.parse(serverTime) : Date.now();
      const base = Number.isNaN(now) ? Date.now() : now;
      return Math.max(0, exp - base + 60_000);
    }
  }
  const ttl = challenge.ttl_ms ?? 300_000;
  return Math.min(600_000, Math.max(30_000, ttl));
}

export function assertChallengeBudget(steps: number, declaredStepCount?: number): void {
  const declared =
    typeof declaredStepCount === 'number' &&
    Number.isInteger(declaredStepCount) &&
    declaredStepCount > 0
      ? declaredStepCount
      : 0;
  const cap = Math.min(MAX_FACTOR_STEPS, Math.max(2, declared));
  if (steps > cap) {
    throw new AppError('app.err.auth.challenge_nested', {
      message: 'Too many sequential factor challenges',
    });
  }
}

/**
 * Collect a factor via onChallenge. Missing callback or abort/timeout -> unattended.
 * Does not busy-loop: waits on the callback, racing ttl_ms.
 */
export async function collectChallenge(
  onChallenge: OnChallenge | undefined,
  req: ChallengeRequest,
  options: { serverTime?: string } = {},
): Promise<{ otp?: string; credential?: object }> {
  if (!onChallenge) {
    throw new AppError('app.err.auth.challenge_unattended', {
      message: 'No onChallenge callback registered',
    });
  }

  const ttl = challengeTtlMs(req.challenge, options.serverTime);
  if (ttl <= 0) {
    throw new AppError('app.err.auth.challenge_unattended', {
      message: 'Challenge TTL elapsed before collection',
    });
  }

  let timedOut = false;
  const timeout = sleep(ttl).then(() => {
    timedOut = true;
    return { abort: true as const };
  });

  const result = await Promise.race([onChallenge(req), timeout]);
  if (timedOut || result.abort) {
    throw new AppError('app.err.auth.challenge_unattended', {
      message: timedOut ? 'Challenge unattended after ttl_ms' : 'Challenge aborted',
    });
  }
  return { otp: result.otp, credential: result.credential };
}
