/**
 * Client feature-flag algorithm (SPEC-v0.5-extreme §3.4).
 *
 * Absence of `state.features` means all 1.1 flags are false and the client
 * stays on 1.0 semantics even if `protocol_version` is 1.1.
 */

import {
  FEATURE_FLAG_KEYS,
  type FeatureFlags,
  type PageManifest,
  type StateNode,
} from './types.js';

const KNOWN_FLAGS: readonly string[] = FEATURE_FLAG_KEYS;

export function emptyFeatureFlags(): FeatureFlags {
  const flags: FeatureFlags = {};
  for (const key of KNOWN_FLAGS) flags[key] = false;
  return flags;
}

export function isStateNode(value: unknown): value is StateNode {
  return !!value && typeof value === 'object' && 'type' in (value as object);
}

/** Unwrap a StateNode tree to JSON-ish values. */
export function unwrapStateNode(node: unknown): unknown {
  if (!isStateNode(node)) return node;
  if (node.type === 'null') return null;
  if (node.type === 'object') {
    const out: Record<string, unknown> = {};
    const obj = (node as { value?: Record<string, StateNode> }).value ?? {};
    for (const [k, v] of Object.entries(obj)) out[k] = unwrapStateNode(v);
    return out;
  }
  if (node.type === 'array') {
    const arr = (node as { value?: unknown[] }).value ?? [];
    return arr.map((child) => unwrapStateNode(child));
  }
  if ('value' in node) return (node as { value: unknown }).value;
  return undefined;
}

export function readBooleanNode(node: unknown): boolean | undefined {
  if (isStateNode(node) && node.type === 'boolean') return node.value === true;
  if (typeof node === 'boolean') return node;
  return undefined;
}

export function readStringNode(node: unknown): string | undefined {
  if (
    isStateNode(node) &&
    (node.type === 'string' ||
      node.type === 'enum' ||
      node.type === 'date' ||
      node.type === 'datetime')
  ) {
    return typeof node.value === 'string' ? node.value : undefined;
  }
  if (typeof node === 'string') return node;
  return undefined;
}

export function readNumberNode(node: unknown): number | undefined {
  if (isStateNode(node) && node.type === 'number') {
    return typeof node.value === 'number' ? node.value : undefined;
  }
  if (typeof node === 'number' && Number.isFinite(node)) return node;
  return undefined;
}

export function readCapabilities(manifest: PageManifest): string[] {
  const cap = manifest.state?.capabilities;
  if (!cap) return [];
  if (cap.type === 'array' && Array.isArray(cap.value)) {
    return cap.value
      .map((n) => readStringNode(n))
      .filter((s): s is string => typeof s === 'string');
  }
  return [];
}

/**
 * Normative §3.4: start all 1.1 flags false. If `state.features` is present,
 * known boolean nodes win (missing = false). If the object is ABSENT, stay
 * on 1.0 semantics and do not enable 1.1 oauth from `auth_oauth`.
 */
export function parseFeatures(manifest: PageManifest): FeatureFlags {
  const flags = emptyFeatureFlags();
  const featuresNode = manifest.state?.features;
  const featuresPresent = isStateNode(featuresNode) && featuresNode.type === 'object';

  if (featuresPresent) {
    const obj = (featuresNode as { value?: Record<string, StateNode> }).value ?? {};
    for (const key of KNOWN_FLAGS) {
      const bool = readBooleanNode(obj[key]);
      flags[key] = bool === true;
    }
    for (const [key, node] of Object.entries(obj)) {
      if (key.startsWith('x_')) {
        flags[key] = readBooleanNode(node) === true;
      }
    }
    return flags;
  }

  // Features object absent: 1.0 semantics. capabilities.auth_oauth does NOT
  // enable the 1.1 oauth complete protocol.
  return flags;
}

export function hasFeature(flags: FeatureFlags, key: string): boolean {
  return flags[key] === true;
}
