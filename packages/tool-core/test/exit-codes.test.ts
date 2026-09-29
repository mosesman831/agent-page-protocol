import { describe, expect, it } from 'vitest';
import { ERROR_REGISTRY } from '@agent-page/client';
import {
  buildEnvelope,
  errorEnvelope,
  exitCodeFor,
  exitCodeForErrorCode,
  registryExitMap,
} from '../src/index.js';

describe('exit codes §8', () => {
  it('every ERROR_REGISTRY code maps to exactly one exit', () => {
    const map = registryExitMap();
    const codes = Object.keys(ERROR_REGISTRY);
    expect(codes.length).toBeGreaterThan(40);
    for (const code of codes) {
      const a = exitCodeForErrorCode(code);
      const b = map[code];
      expect(a).toBe(b);
      expect(Number.isInteger(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(25);
    }
  });

  it('tool-local codes', () => {
    expect(exitCodeForErrorCode('app.err.tool.usage')).toBe(2);
    expect(exitCodeForErrorCode('app.err.tool.not_a_tty')).toBe(2);
    expect(exitCodeForErrorCode('app.err.tool.hold_mismatch')).toBe(2);
    expect(exitCodeForErrorCode('app.err.tool.session_origin_mismatch')).toBe(2);
    expect(exitCodeForErrorCode('app.err.tool.config_secret')).toBe(2);
    expect(exitCodeForErrorCode('app.err.tool.session_missing')).toBe(24);
    expect(exitCodeForErrorCode('app.err.tool.session_locked')).toBe(24);
    expect(exitCodeForErrorCode('app.err.tool.session_readonly')).toBe(24);
    expect(exitCodeForErrorCode('app.err.tool.session_corrupt')).toBe(24);
    expect(exitCodeForErrorCode('app.err.tool.hold_unsupported')).toBe(25);
    expect(exitCodeForErrorCode('app.err.tool.file_unreadable')).toBe(18);
    expect(exitCodeForErrorCode('app.err.tool.internal')).toBe(1);
  });

  it('table families and hold statuses', () => {
    expect(exitCodeFor(buildEnvelope('ok'))).toBe(0);
    expect(exitCodeFor(buildEnvelope('async_failed'))).toBe(0);
    expect(
      exitCodeFor(
        buildEnvelope('hold', {
          hold: { kind: 'confirmation', action: 'pay', page_url: 'http://x' },
        }),
      ),
    ).toBe(10);
    expect(
      exitCodeFor(
        buildEnvelope('hold', { hold: { kind: 'otp', action: 'login', page_url: 'http://x' } }),
      ),
    ).toBe(11);
    expect(
      exitCodeFor(
        buildEnvelope('hold', {
          hold: { kind: 'human_verification', action: 'pay', page_url: 'http://x' },
        }),
      ),
    ).toBe(12);
    expect(
      exitCodeFor(
        buildEnvelope('hold', { hold: { kind: 'consent', action: 'x', page_url: 'http://x' } }),
      ),
    ).toBe(13);
    expect(
      exitCodeFor(
        buildEnvelope('hold', { hold: { kind: 'auth', action: 'x', page_url: 'http://x' } }),
      ),
    ).toBe(14);
    expect(exitCodeFor(errorEnvelope('app.err.action.confirmation_invalid', 'x'))).toBe(21);
    expect(exitCodeFor(errorEnvelope('app.err.action.confirmation_required', 'x'))).toBe(10);
    expect(exitCodeFor(errorEnvelope('app.err.transport.timeout', 'x'))).toBe(4);
    expect(exitCodeFor(errorEnvelope('app.err.transport.timeout', 'x'), { asyncPoll: true })).toBe(
      23,
    );
  });
});
