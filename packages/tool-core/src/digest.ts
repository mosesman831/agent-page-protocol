/**
 * digest() PageDigest + stateDelta() (CLIENT-TOOL-CONTRACT §5).
 * present stripped; secrets redacted; table top_k=8; money integer+scale.
 */

import {
  AppError,
  isSoftErrorCode,
  listActions,
  redactSecrets,
  summarizeArrays,
  type DiffDocument,
  type PageManifest,
  type StateNode,
} from '@agent-page/client';
import type { ActionSummary, PageDigest, PageRef } from './types.js';
import { DEFAULT_TOP_K } from './types.js';

export interface DigestOptions {
  topK?: number;
  capabilities?: string[];
  features?: Record<string, boolean>;
  full?: boolean;
  raw?: boolean;
}

function pageRef(manifest: PageManifest): PageRef {
  const p = manifest.page;
  return {
    id: p.id,
    url: p.url,
    version: p.version,
    ...(p.title !== undefined ? { title: p.title } : {}),
    ...(p.etag !== undefined ? { etag: p.etag } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
  };
}

function policyForDigest(def: {
  policy?: Record<string, unknown>;
}): ActionSummary['policy'] | undefined {
  const policy = def.policy;
  if (!policy || typeof policy !== 'object') return undefined;
  const out: NonNullable<ActionSummary['policy']> = {};
  if (Array.isArray(policy.pii_params))
    out.pii_params = policy.pii_params.filter((x) => typeof x === 'string');
  if (Array.isArray(policy.scopes)) out.scopes = policy.scopes.filter((x) => typeof x === 'string');
  if (policy.max_financial !== undefined) out.max_financial = policy.max_financial;
  if (typeof policy.key_header === 'string') out.key_header = policy.key_header;
  return Object.keys(out).length ? out : undefined;
}

function actionSummaries(manifest: PageManifest): ActionSummary[] {
  const actions = manifest.actions ?? {};
  const listed = listActions(manifest);
  return Object.entries(actions).map(([id, def]) => {
    const base = listed.find((a) => a.id === id);
    const summary: ActionSummary = {
      id,
      description: def.description,
      kind: def.kind,
      side_effect: def.side_effect ?? 'safe',
      requires_confirmation: !!def.requires_confirmation,
      idempotent: base?.idempotent ?? def.idempotent !== false,
      auth: def.auth ?? 'none',
      param_mode: def.param_mode ?? 'strict',
      requires_etag_match: !!def.requires_etag_match,
      timeout_ms: def.timeout_ms,
      async: !!def.async,
      input: (def.input ?? {}) as Record<string, unknown>,
      output: def.output as Record<string, unknown> | undefined,
    };
    const policy = policyForDigest(def);
    if (policy) summary.policy = policy;
    return summary;
  });
}

function isCollection(node: unknown): node is { type: string; value: unknown[] } {
  return (
    !!node &&
    typeof node === 'object' &&
    'type' in node &&
    ((node as { type: string }).type === 'table' || (node as { type: string }).type === 'array') &&
    Array.isArray((node as { value?: unknown }).value)
  );
}

function collectionTruncated(original: PageManifest, topK: number): boolean {
  if (topK <= 0) return false;
  for (const node of Object.values(original.state ?? {})) {
    if (isCollection(node) && node.value.length > topK) return true;
  }
  return false;
}

/** Strip digest-illegal extra members (e.g. SDK _truncated) from StateNodes. */
function cleanState(state: Record<string, StateNode>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(state ?? {})) {
    if (key === 'present') continue;
    if (node && typeof node === 'object' && '_truncated' in node) {
      const { _truncated: _t, ...rest } = node as StateNode & { _truncated?: boolean };
      out[key] = rest;
    } else {
      out[key] = node;
    }
  }
  return out;
}

/**
 * Compact PageDigest. Secrets already [REDACTED]; /present never appears;
 * money nodes keep integer value + scale.
 */
export function digest(manifest: PageManifest, options: DigestOptions = {}): PageDigest {
  const topK = options.topK ?? DEFAULT_TOP_K;
  let m = redactSecrets(manifest);
  const { present: _present, ...withoutPresent } = m as PageManifest & { present?: unknown };
  m = withoutPresent as PageManifest;
  if (m.state && 'present' in m.state) {
    const { present: _p, ...rest } = m.state as Record<string, StateNode> & { present?: unknown };
    m = { ...m, state: rest };
  }

  if (m.error?.code && !isSoftErrorCode(m.error.code)) {
    throw new AppError('app.err.manifest.invalid', {
      message: `Soft error channel used with non-soft code: ${m.error.code}`,
    });
  }

  const truncated = collectionTruncated(m, topK);
  let state: Record<string, unknown>;
  if (topK === 0 || options.raw) {
    state = cleanState(m.state ?? {});
  } else {
    const summarized = summarizeArrays(m, topK);
    state = cleanState(summarized.state ?? {});
  }

  return {
    page: pageRef(m),
    state,
    actions: actionSummaries(m),
    navigation: m.navigation ?? null,
    soft_error: m.error ?? null,
    capabilities: options.capabilities ?? [],
    features: options.features ?? {},
    truncated,
    top_k: topK,
  };
}

export interface StateDeltaResult {
  state_delta: Record<string, unknown>;
  actions_delta: { added: string[]; removed: string[]; replaced: string[] };
}

/** Extract state_delta from applied diff ops (§5.2). */
export function stateDelta(
  diffOps: DiffDocument['diff'] | unknown[],
  postManifest: PageManifest,
): StateDeltaResult {
  const stateKeys = new Set<string>();
  const actionsDelta = { added: [] as string[], removed: [] as string[], replaced: [] as string[] };

  for (const raw of diffOps as Array<{ op?: string; path?: string }>) {
    const path = raw.path ?? '';
    if (path === '/present' || path.startsWith('/present/')) continue;
    const stateMatch = /^\/state\/([^/]+)/.exec(path);
    if (stateMatch) {
      stateKeys.add(stateMatch[1]!);
      continue;
    }
    const actionMatch = /^\/actions\/([^/]+)/.exec(path);
    if (actionMatch) {
      const id = actionMatch[1]!;
      if (raw.op === 'add') actionsDelta.added.push(id);
      else if (raw.op === 'remove') actionsDelta.removed.push(id);
      else actionsDelta.replaced.push(id);
    }
  }

  const state_delta: Record<string, unknown> = {};
  for (const key of stateKeys) {
    if (key === 'present') continue;
    state_delta[key] =
      postManifest.state && key in postManifest.state ? postManifest.state[key] : null;
  }

  return { state_delta, actions_delta: actionsDelta };
}

/** Full-manifest fallback: empty diff, truncated state as delta. */
export function fullStateDelta(
  postManifest: PageManifest,
  options: DigestOptions = {},
): StateDeltaResult & { diff: [] } {
  const d = digest(postManifest, options);
  return {
    diff: [],
    state_delta: d.state,
    actions_delta: { added: [], removed: [], replaced: [] },
  };
}
