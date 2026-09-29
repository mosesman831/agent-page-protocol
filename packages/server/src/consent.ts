/**
 * Consent purpose gate (SPEC §8).
 * `necessary` is always granted and not revocable.
 * Missing grants => 403 consent.required with details.missing and grant_consent.
 * Version bump resets non-necessary grants.
 * Stale version => 409 consent.version_stale.
 */

import { AppError, detailString } from './errors.js';
import type { ConsentPurposeId, StateNode } from './types.js';

export const CLOSED_PURPOSES: readonly ConsentPurposeId[] = [
  'necessary',
  'functional',
  'analytics',
  'marketing',
  'personalization',
  'sharing_third_party',
];

const CLOSED_SET = new Set<string>(CLOSED_PURPOSES);

export function isConsentPurposeId(id: string): boolean {
  if (CLOSED_SET.has(id)) return true;
  return /^x[-_][a-z0-9][a-z0-9_-]{0,62}$/i.test(id);
}

export interface ConsentGrantState {
  id: string;
  granted: boolean;
  required?: boolean;
}

export interface ConsentState {
  version: string;
  /** True when a required purpose is ungranted — gates actions (§5.8). */
  required?: boolean;
  purposes: ConsentGrantState[];
}

export function emptyConsent(version = '1'): ConsentState {
  return {
    version,
    purposes: [{ id: 'necessary', granted: true, required: true }],
  };
}

export function isGranted(state: ConsentState, purposeId: string): boolean {
  if (purposeId === 'necessary') return true;
  const row = state.purposes.find((p) => p.id === purposeId);
  return row?.granted === true;
}

export function grantMap(state: ConsentState): Record<string, boolean> {
  const out: Record<string, boolean> = { necessary: true };
  for (const p of state.purposes) {
    out[p.id] = p.id === 'necessary' ? true : p.granted;
  }
  return out;
}

export type ConsentGateResult = { ok: true } | { ok: false; error: AppError };

/**
 * Per-action purpose gate. Missing grants => 403 with details.missing and recoverable_actions.
 */
export function checkConsentGate(
  requiredPurposes: string[] | undefined,
  state: ConsentState,
  opts: { grantActionId?: string } = {},
): ConsentGateResult {
  if (!requiredPurposes || requiredPurposes.length === 0) return { ok: true };
  const missing: string[] = [];
  for (const id of requiredPurposes) {
    if (!isConsentPurposeId(id)) {
      return {
        ok: false,
        error: new AppError('app.err.consent.unknown_purpose', {
          message: `Unknown consent purpose: ${id}`,
          path: '/policy/consent_purposes',
        }),
      };
    }
    if (!isGranted(state, id)) missing.push(id);
  }
  if (missing.length === 0) return { ok: true };
  const missingNode: StateNode = {
    type: 'array',
    value: missing.map((id) => detailString(id)),
  };
  return {
    ok: false,
    error: new AppError('app.err.consent.required', {
      message: 'Consent grant required for this action',
      details: { missing: missingNode },
      recoverable_actions: [opts.grantActionId ?? 'grant_consent'],
    }),
  };
}

export function applyGrants(
  state: ConsentState,
  grants: Array<{ id: string; granted: boolean }>,
  expectedVersion?: string,
): ConsentState {
  if (expectedVersion !== undefined && expectedVersion !== state.version) {
    throw new AppError('app.err.consent.version_stale', {
      message: 'Consent version is stale; re-GET and retry',
    });
  }
  const map = grantMap(state);
  for (const g of grants) {
    if (!isConsentPurposeId(g.id)) {
      throw new AppError('app.err.consent.unknown_purpose', {
        message: `Unknown consent purpose: ${g.id}`,
      });
    }
    if (g.id === 'necessary') {
      map.necessary = true;
      continue;
    }
    map[g.id] = g.granted;
  }
  map.necessary = true;
  const purposes: ConsentGrantState[] = Object.entries(map).map(([id, granted]) => ({
    id,
    granted: id === 'necessary' ? true : granted,
    required: id === 'necessary',
  }));
  return { version: state.version, purposes };
}

export function revokeConsent(state: ConsentState, ids: string[]): ConsentState {
  const map = grantMap(state);
  for (const id of ids) {
    if (!isConsentPurposeId(id)) {
      throw new AppError('app.err.consent.unknown_purpose', {
        message: `Unknown consent purpose: ${id}`,
      });
    }
    if (id === 'necessary') continue;
    map[id] = false;
  }
  map.necessary = true;
  const purposes: ConsentGrantState[] = Object.entries(map).map(([id, granted]) => ({
    id,
    granted: id === 'necessary' ? true : granted,
    required: id === 'necessary',
  }));
  return { version: state.version, purposes };
}

/** Policy text / catalog change: bump version and reset non-necessary grants. */
export function bumpConsentVersion(state: ConsentState, nextVersion: string): ConsentState {
  const purposes = state.purposes.map((p) =>
    p.id === 'necessary' ? { ...p, granted: true } : { ...p, granted: false },
  );
  if (!purposes.some((p) => p.id === 'necessary')) {
    purposes.unshift({ id: 'necessary', granted: true, required: true });
  }
  return { version: nextVersion, purposes };
}

export function assertConsentVersion(state: ConsentState, postedVersion: string | undefined): void {
  if (postedVersion !== undefined && postedVersion !== state.version) {
    throw new AppError('app.err.consent.version_stale', {
      message: 'Consent version is stale; re-GET and retry',
    });
  }
}
