/**
 * exitCodeFor(envelope) per CLIENT-TOOL-CONTRACT §8.
 */

import { ERROR_REGISTRY } from '@agent-page/client';
import type { ToolEnvelope, ToolStatus } from './types.js';

const TOOL_LOCAL_EXIT: Record<string, number> = {
  'app.err.tool.usage': 2,
  'app.err.tool.not_a_tty': 2,
  'app.err.tool.hold_mismatch': 2,
  'app.err.tool.session_origin_mismatch': 2,
  'app.err.tool.config_secret': 2,
  'app.err.tool.hold_unsupported': 25,
  'app.err.tool.session_missing': 24,
  'app.err.tool.session_locked': 24,
  'app.err.tool.session_readonly': 24,
  'app.err.tool.session_corrupt': 24,
  'app.err.tool.file_unreadable': 18,
  'app.err.tool.internal': 1,
};

const EXACT_EXIT: Record<string, number> = {
  ...TOOL_LOCAL_EXIT,
  'app.err.action.confirmation_required': 10,
  'app.err.auth.challenge_required': 11,
  'app.err.auth.challenge_failed': 11,
  'app.err.auth.challenge_unattended': 11,
  'app.err.auth.challenge_nested': 11,
  'app.err.hold.human_required': 12,
  'app.err.hold.unattended': 12,
  'app.err.hold.budget_exceeded': 12,
  'app.err.consent.required': 13,
  'app.err.auth.required': 14,
  'app.err.auth.expired': 14,
  'app.err.auth.challenge_expired': 14,
  'app.err.auth.resume_invalid': 14,
  'app.err.policy.denied': 15,
  'app.err.action.forbidden_kind': 15,
  'app.err.diff.conflict_persistent': 16,
  'app.err.diff.conflict': 16,
  'app.err.diff.stale_base': 16,
  'app.err.diff.test_failed': 16,
  'app.err.diff.apply_failed': 16,
  'app.err.rate.limited': 17,
  'app.err.action.upload_unsupported': 18,
  'app.err.action.not_found': 19,
  'app.err.action.unavailable': 19,
  'app.err.action.idempotency_conflict': 19,
  'app.err.action.conflict': 19,
  'app.err.page.not_found': 20,
  'app.err.page.gone': 20,
  'app.err.security.origin': 21,
  'app.err.security.csrf': 21,
  'app.err.security.cross_origin': 21,
  'app.err.auth.forbidden': 21,
  'app.err.auth.insufficient_scope': 21,
  'app.err.action.confirmation_invalid': 21,
  'app.err.version.unsupported': 25,
  'app.err.security.tls': 4,
};

const PREFIX_EXIT: Array<[string, number]> = [
  ['app.err.tool.usage', 2],
  ['app.err.manifest.', 3],
  ['app.err.payload.', 3],
  ['app.err.state.', 3],
  ['app.err.transport.', 4],
  ['app.err.validation.', 18],
  ['app.err.discovery.', 22],
  ['app.err.negotiate.', 25],
  ['app.err.internal.', 1],
];

export function exitCodeForErrorCode(code: string): number {
  if (EXACT_EXIT[code] !== undefined) return EXACT_EXIT[code]!;
  for (const [prefix, exit] of PREFIX_EXIT) {
    if (code === prefix || code.startsWith(prefix)) return exit;
  }
  return 1;
}

function holdExit(envelope: ToolEnvelope): number {
  const kind = envelope.hold?.kind;
  if (kind === 'confirmation' || kind === 'delegate') return 10;
  if (kind === 'mfa' || kind === 'otp') return 11;
  if (kind === 'human_verification') return 12;
  if (kind === 'consent') return 13;
  if (kind === 'auth') return 14;
  const code = envelope.error?.code;
  if (code) {
    const mapped = exitCodeForErrorCode(code);
    if (mapped >= 10 && mapped <= 14) return mapped;
  }
  return 10;
}

const SUCCESS: ReadonlySet<ToolStatus> = new Set([
  'ok',
  'navigated',
  'not_modified',
  'async_pending',
  'async_succeeded',
  'closed',
]);

export function exitCodeFor(
  envelope: ToolEnvelope,
  opts: { failOnSoft?: boolean; asyncPoll?: boolean } = {},
): number {
  if (envelope.status === 'hold') return holdExit(envelope);
  if (SUCCESS.has(envelope.status)) return 0;
  if (envelope.status === 'async_failed') return opts.failOnSoft ? 1 : 0;

  const code = envelope.error?.code ?? 'app.err.internal.server';
  if (opts.asyncPoll && code === 'app.err.transport.timeout') return 23;
  return exitCodeForErrorCode(code);
}

/** Every ERROR_REGISTRY code maps to exactly one exit. */
export function registryExitMap(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of Object.keys(ERROR_REGISTRY)) {
    out[code] = exitCodeForErrorCode(code);
  }
  for (const code of Object.keys(TOOL_LOCAL_EXIT)) {
    out[code] = TOOL_LOCAL_EXIT[code]!;
  }
  return out;
}
