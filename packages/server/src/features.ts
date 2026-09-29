/**
 * Feature flag parse + implication rules (SPEC §3.2).
 */

import {
  FEATURE_FLAG_KEYS,
  type FeatureFlags,
  type StateNode,
  type ValidationFailure,
} from './types.js';

const FLAG_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

function fail(code: string, message: string, path?: string): ValidationFailure {
  return { code, message, path };
}

function isBooleanNode(node: unknown): node is { type: 'boolean'; value: boolean } {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as StateNode).type === 'boolean' &&
    typeof (node as { value?: unknown }).value === 'boolean'
  );
}

function emptyFlags(): FeatureFlags {
  const flags: FeatureFlags = {};
  for (const key of FEATURE_FLAG_KEYS) {
    flags[key] = false;
  }
  return flags;
}

function featuresMap(features: unknown): Record<string, unknown> | null {
  if (features === null || typeof features !== 'object' || Array.isArray(features)) {
    return null;
  }
  const node = features as Record<string, unknown>;
  if (
    node.type === 'object' &&
    node.value !== null &&
    typeof node.value === 'object' &&
    !Array.isArray(node.value)
  ) {
    return node.value as Record<string, unknown>;
  }
  if (!('type' in node)) {
    return node;
  }
  return null;
}

/**
 * Parse `state.features` (object of boolean StateNodes) into a flag map.
 * Missing known flags default false. Unknown keys are ignored (vendor `x_*` kept).
 */
export function parseFeatureFlags(features: unknown): FeatureFlags {
  const flags = emptyFlags();
  const map = featuresMap(features);
  if (!map) return flags;

  for (const [key, node] of Object.entries(map)) {
    if (!FLAG_KEY_RE.test(key)) continue;
    let boolVal: boolean | undefined;
    if (isBooleanNode(node)) {
      boolVal = node.value;
    } else if (typeof node === 'boolean') {
      boolVal = node;
    }
    if (boolVal === undefined) continue;
    if ((FEATURE_FLAG_KEYS as readonly string[]).includes(key) || key.startsWith('x_')) {
      flags[key] = boolVal;
    }
  }
  return flags;
}

export interface FeatureImplicationResult {
  ok: boolean;
  errors: ValidationFailure[];
  warnings: string[];
}

/**
 * Implication rules (SPEC §3.2 MUST / SHOULD):
 * - events_sse or events_ws => events_longpoll MUST true
 * - order_state => commerce MUST true
 * - passkey / magic_link / mfa => identity_flows SHOULD true
 */
export function validateFeatureImplications(flags: FeatureFlags): FeatureImplicationResult {
  const errors: ValidationFailure[] = [];
  const warnings: string[] = [];

  if ((flags.events_sse || flags.events_ws) && !flags.events_longpoll) {
    errors.push(
      fail(
        'app.err.feature.unsupported',
        'events_sse/events_ws require events_longpoll to be true',
        '/state/features/value/events_longpoll',
      ),
    );
  }
  if (flags.order_state && !flags.commerce) {
    errors.push(
      fail(
        'app.err.feature.unsupported',
        'order_state requires commerce to be true',
        '/state/features/value/commerce',
      ),
    );
  }
  if ((flags.passkey || flags.magic_link || flags.mfa) && !flags.identity_flows) {
    warnings.push('passkey/magic_link/mfa SHOULD imply identity_flows');
  }
  if (flags.file_presign) {
    warnings.push(
      'file_presign SHOULD appear with v0.4 capability file_upload unless presign-only',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** True when a 1.1 mechanism may be invoked given advertised flags. */
export function featureEnabled(flags: FeatureFlags | undefined, key: string): boolean {
  if (!flags) return false;
  return flags[key] === true;
}
