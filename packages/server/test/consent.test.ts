import { describe, it, expect } from 'vitest';
import {
  applyGrants,
  bumpConsentVersion,
  checkConsentGate,
  emptyConsent,
  isGranted,
  revokeConsent,
} from '../src/consent.js';
import { AppError } from '../src/errors.js';

describe('consent purpose gate (§8)', () => {
  it('treats necessary as always granted and not revocable', () => {
    const state = emptyConsent('v1');
    expect(isGranted(state, 'necessary')).toBe(true);
    const revoked = revokeConsent(state, ['necessary', 'analytics']);
    expect(isGranted(revoked, 'necessary')).toBe(true);
    const granted = applyGrants(state, [{ id: 'necessary', granted: false }]);
    expect(isGranted(granted, 'necessary')).toBe(true);
  });

  it('returns 403 consent.required with details.missing and grant_consent', () => {
    const state = emptyConsent('v1');
    const r = checkConsentGate(['analytics'], state);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.envelope.error.code).toBe('app.err.consent.required');
    expect(r.error.httpStatus).toBe(403);
    expect(r.error.envelope.error.recoverable_actions).toEqual(['grant_consent']);
    expect(r.error.envelope.error.details?.missing).toMatchObject({
      type: 'array',
      value: [{ type: 'string', value: 'analytics' }],
    });
  });

  it('version bump resets non-necessary grants', () => {
    const granted = applyGrants(emptyConsent('2026-01'), [{ id: 'analytics', granted: true }]);
    expect(isGranted(granted, 'analytics')).toBe(true);
    const bumped = bumpConsentVersion(granted, '2026-08');
    expect(bumped.version).toBe('2026-08');
    expect(isGranted(bumped, 'necessary')).toBe(true);
    expect(isGranted(bumped, 'analytics')).toBe(false);
  });

  it('stale version => 409 consent.version_stale', () => {
    const state = emptyConsent('v1');
    expect(() => applyGrants(state, [{ id: 'analytics', granted: true }], 'v0')).toThrow(AppError);
    try {
      applyGrants(state, [{ id: 'analytics', granted: true }], 'v0');
    } catch (e) {
      const err = e as AppError;
      expect(err.envelope.error.code).toBe('app.err.consent.version_stale');
      expect(err.httpStatus).toBe(409);
    }
  });
});
