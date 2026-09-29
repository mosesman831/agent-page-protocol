import { describe, expect, it } from 'vitest';
import {
  buildEnvelope,
  errorEnvelope,
  validateEnvelope,
  EnvelopeError,
  type ToolEnvelope,
} from '../src/index.js';

describe('ToolEnvelope invariants §4.2', () => {
  it('ok === true iff success statuses', () => {
    for (const status of [
      'ok',
      'navigated',
      'not_modified',
      'async_pending',
      'async_succeeded',
      'closed',
    ] as const) {
      const env = buildEnvelope(status);
      expect(env.ok).toBe(true);
      expect(env.app).toBe('1.0');
      expect(env.tool).toBe('1.0');
    }
  });

  it('ok === false iff hold / error / async_failed', () => {
    const hold = buildEnvelope('hold', {
      hold: { kind: 'confirmation', action: 'pay', page_url: 'https://example.com/p' },
    });
    expect(hold.ok).toBe(false);
    expect(hold.error).toBeUndefined();

    const err = errorEnvelope('app.err.page.not_found', 'missing');
    expect(err.ok).toBe(false);
    expect(err.status).toBe('error');
    expect(err.error?.code).toBe('app.err.page.not_found');

    const failed = buildEnvelope('async_failed', {
      error: { code: 'app.err.action.async_failed', message: 'failed', retryable: true },
    });
    expect(failed.ok).toBe(false);
  });

  it('unknown status rejected', () => {
    expect(() => validateEnvelope({ app: '1.0', tool: '1.0', ok: true, status: 'nope' })).toThrow(
      EnvelopeError,
    );
    expect(() => buildEnvelope('nope' as unknown as ToolEnvelope['status'])).toThrow(EnvelopeError);
  });

  it('hold cannot carry error', () => {
    const env = buildEnvelope('hold', {
      hold: { kind: 'confirmation', action: 'pay', page_url: 'https://example.com/p' },
      error: { code: 'app.err.action.confirmation_required', message: 'x', retryable: false },
    });
    expect(env.error).toBeUndefined();
    expect(env.hold).toBeTruthy();

    expect(() =>
      validateEnvelope({
        app: '1.0',
        tool: '1.0',
        ok: false,
        status: 'hold',
        hold: { kind: 'confirmation', action: 'pay', page_url: 'https://example.com/p' },
        error: { code: 'app.err.action.confirmation_required', message: 'x', retryable: false },
      }),
    ).toThrow(/MUST NOT include error/);
  });

  it('error status requires error.code', () => {
    expect(() => validateEnvelope({ app: '1.0', tool: '1.0', ok: false, status: 'error' })).toThrow(
      /MUST include error/,
    );
  });
});
