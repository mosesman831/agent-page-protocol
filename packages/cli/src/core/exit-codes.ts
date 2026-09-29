import type { ToolEnvelope } from './types.js';

/** Map ToolEnvelope / error.code to CLI exit codes (§8). */
export function exitCodeFor(envelope: ToolEnvelope): number {
  if (envelope.status === 'hold') {
    const kind = envelope.hold?.kind;
    if (kind === 'confirmation' || kind === 'delegate') return 10;
    if (kind === 'mfa' || kind === 'otp') return 11;
    if (kind === 'human_verification') return 12;
    if (kind === 'consent') return 13;
    if (kind === 'auth') return 14;
    return 10;
  }

  if (
    envelope.status === 'ok' ||
    envelope.status === 'navigated' ||
    envelope.status === 'not_modified' ||
    envelope.status === 'async_pending' ||
    envelope.status === 'async_succeeded' ||
    envelope.status === 'closed'
  ) {
    return 0;
  }

  if (envelope.status === 'async_failed') {
    return 0;
  }

  const code = envelope.error?.code ?? 'app.err.internal.server';
  return exitCodeForErrorCode(code);
}

export function exitCodeForErrorCode(code: string): number {
  if (
    code.startsWith('app.err.tool.usage') ||
    code === 'app.err.tool.not_a_tty' ||
    code === 'app.err.tool.hold_mismatch' ||
    code === 'app.err.tool.session_origin_mismatch' ||
    code === 'app.err.tool.config_secret'
  ) {
    return 2;
  }
  if (
    code === 'app.err.tool.session_missing' ||
    code === 'app.err.tool.session_locked' ||
    code === 'app.err.tool.session_readonly' ||
    code === 'app.err.tool.session_corrupt'
  ) {
    return 24;
  }
  if (code === 'app.err.tool.hold_unsupported') return 25;
  if (code === 'app.err.tool.file_unreadable') return 18;
  if (code === 'app.err.tool.internal') return 1;

  if (
    code.startsWith('app.err.manifest.') ||
    code.startsWith('app.err.payload.') ||
    code.startsWith('app.err.state.') ||
    code === 'app.err.diff.invalid_path'
  ) {
    return 3;
  }
  if (code.startsWith('app.err.transport.') || code === 'app.err.security.tls') {
    if (code === 'app.err.transport.timeout') return 4;
    return 4;
  }
  if (code === 'app.err.action.confirmation_required') return 10;
  if (
    code === 'app.err.auth.challenge_required' ||
    code === 'app.err.auth.challenge_failed' ||
    code === 'app.err.auth.challenge_unattended' ||
    code === 'app.err.auth.challenge_nested'
  ) {
    return 11;
  }
  if (
    code === 'app.err.hold.human_required' ||
    code === 'app.err.hold.unattended' ||
    code === 'app.err.hold.budget_exceeded'
  ) {
    return 12;
  }
  if (code === 'app.err.consent.required') return 13;
  if (
    code === 'app.err.auth.required' ||
    code === 'app.err.auth.expired' ||
    code === 'app.err.auth.challenge_expired' ||
    code === 'app.err.auth.resume_invalid'
  ) {
    return 14;
  }
  if (code === 'app.err.policy.denied' || code === 'app.err.action.forbidden_kind') {
    return 15;
  }
  if (
    code === 'app.err.diff.conflict_persistent' ||
    code === 'app.err.diff.conflict' ||
    code === 'app.err.diff.stale_base' ||
    code === 'app.err.diff.test_failed' ||
    code === 'app.err.diff.apply_failed'
  ) {
    return 16;
  }
  if (code === 'app.err.rate.limited') return 17;
  if (code.startsWith('app.err.validation.') || code === 'app.err.action.upload_unsupported') {
    return 18;
  }
  if (
    code === 'app.err.action.not_found' ||
    code === 'app.err.action.unavailable' ||
    code === 'app.err.action.idempotency_conflict' ||
    code === 'app.err.action.conflict'
  ) {
    return 19;
  }
  if (code === 'app.err.page.not_found' || code === 'app.err.page.gone') return 20;
  if (
    code === 'app.err.security.origin' ||
    code === 'app.err.security.csrf' ||
    code === 'app.err.security.cross_origin' ||
    code === 'app.err.auth.forbidden' ||
    code === 'app.err.auth.insufficient_scope' ||
    code === 'app.err.action.confirmation_invalid'
  ) {
    return 21;
  }
  if (code.startsWith('app.err.discovery.')) return 22;
  if (code === 'app.err.version.unsupported' || code.startsWith('app.err.negotiate.')) {
    return 25;
  }
  return 1;
}
