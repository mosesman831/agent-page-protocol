/**
 * v0.4 capability array + v0.5 features object.
 * Absence of features = all 1.1 flags false (SPEC-v0.5 D-7 / §3).
 */

export type FeatureFlags = Record<string, boolean>;

const KNOWN_AUTH = new Set(['none', 'session', 'bearer', 'api_key', 'user']);

/** v0.5 §3.2 flags. Copied here because client dist may not yet export FEATURE_FLAG_KEYS. */
export const V11_FEATURE_FLAGS = [
  'identity_flows',
  'mfa',
  'passkey',
  'oauth',
  'magic_link',
  'human_hold',
  'consent',
  'events_sse',
  'events_longpoll',
  'events_ws',
  'session_resume',
  'typeahead',
  'file_presign',
  'geopoint',
  'quantity',
  'datetime_range',
  'bulk_actions',
  'commerce',
  'order_state',
  'deep_focus',
  'locale_tz',
  'error_i18n',
  'action_result_pagination',
  'drafts',
] as const;

export function emptyFeatures(): FeatureFlags {
  const flags: FeatureFlags = {};
  for (const k of V11_FEATURE_FLAGS) flags[k] = false;
  return flags;
}

function flattenBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'type' in (value as object)) {
    const n = value as { type?: string; value?: unknown };
    if (n.type === 'boolean') return n.value === true;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if ('type' in value && (value as { type?: string }).type === 'object') {
    const inner = (value as { value?: unknown }).value;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
    return null;
  }
  return value as Record<string, unknown>;
}

function readWellKnownState(wellKnown: unknown): Record<string, unknown> | null {
  if (!wellKnown || typeof wellKnown !== 'object') return null;
  const root = wellKnown as Record<string, unknown>;
  return asRecord(root.state) ?? null;
}

/**
 * Flatten well-known `state.features` boolean nodes.
 * Absent object => {} with every 1.1 flag false. Unknown flags ignored.
 */
export function featuresFromWellKnown(wellKnown: unknown): FeatureFlags {
  const flags = emptyFeatures();
  if (!wellKnown || typeof wellKnown !== 'object') return flags;

  const root = wellKnown as Record<string, unknown>;
  const state = readWellKnownState(wellKnown);
  const raw = asRecord(state?.features) ?? asRecord(root.features);
  if (!raw) return flags;

  const known = new Set<string>(V11_FEATURE_FLAGS);
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k) && !k.startsWith('x_')) continue;
    const b = flattenBool(v);
    if (b === undefined) continue;
    flags[k] = b;
  }
  return flags;
}

function readStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string');
  }
  if (typeof value === 'object' && (value as { type?: string }).type === 'array') {
    const items = (value as { value?: unknown[] }).value;
    if (!Array.isArray(items)) return [];
    const out: string[] = [];
    for (const item of items) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object' && (item as { type?: string }).type === 'string') {
        const v = (item as { value?: unknown }).value;
        if (typeof v === 'string') out.push(v);
      }
    }
    return out;
  }
  return [];
}

/** Unknown capability strings are ignored (never fatal). Non-strings dropped. */
export function capabilitiesFromWellKnown(wellKnown: unknown): string[] {
  if (!wellKnown || typeof wellKnown !== 'object') return [];
  const root = wellKnown as Record<string, unknown>;
  const state = readWellKnownState(wellKnown);
  const fromRoot = readStringArray(root.capabilities);
  const fromState = readStringArray(state?.capabilities);
  const merged = fromRoot.length ? fromRoot : fromState;
  return merged.filter((c) => typeof c === 'string' && c.length > 0);
}

function flattenString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'type' in (value as object)) {
    const n = value as { type?: string; value?: unknown };
    if ((n.type === 'string' || n.type === 'enum') && typeof n.value === 'string') {
      return n.value;
    }
  }
  return undefined;
}

/**
 * Flatten well-known `state.entry_urls` (string nodes or plain strings).
 * Falls back to a root-level plain map. Non-string entries dropped.
 */
export function entryUrlsFromWellKnown(wellKnown: unknown): Record<string, string> {
  if (!wellKnown || typeof wellKnown !== 'object') return {};
  const root = wellKnown as Record<string, unknown>;
  const state = readWellKnownState(wellKnown);
  const raw = asRecord(state?.entry_urls) ?? asRecord(root.entry_urls);
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = flattenString(v);
    if (s) out[k] = s;
  }
  return out;
}

/**
 * Unknown auth is treated as `user` (v0.4 §6.10). Tools then require an explicit hold.
 */
export function normalizeAuth(auth: string | undefined | null): string {
  if (!auth) return 'none';
  if (KNOWN_AUTH.has(auth)) return auth;
  return 'user';
}

export function allV11FlagsFalse(features: FeatureFlags | undefined | null): boolean {
  const f = features ?? emptyFeatures();
  return V11_FEATURE_FLAGS.every((k) => f[k] !== true);
}

export function featureEnabled(features: FeatureFlags | undefined | null, name: string): boolean {
  return features?.[name] === true;
}
