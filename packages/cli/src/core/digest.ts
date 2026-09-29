import {
  listActions,
  prepareForPlanner,
  redactSecrets,
  summarizeArrays,
  type PageManifest,
  type DiffDocument,
} from '@agent-page/client';
import type { ActionSummary, PageDigest, PageRef } from './types.js';

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

function actionSummaries(manifest: PageManifest): ActionSummary[] {
  const actions = manifest.actions ?? {};
  return Object.entries(actions).map(([id, def]) => {
    const base = listActions(manifest).find((a) => a.id === id);
    return {
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
  });
}

/** Build a compact PageDigest (§5). */
export function digest(manifest: PageManifest, options: DigestOptions = {}): PageDigest {
  const topK = options.topK ?? 8;
  let m = redactSecrets(manifest);
  const { present: _present, ...withoutPresent } = m as PageManifest & { present?: unknown };
  m = withoutPresent as PageManifest;

  let truncated = false;
  let state: Record<string, unknown>;

  if (options.raw) {
    const prepared = prepareForPlanner(m, 0);
    state = (prepared.state ?? {}) as Record<string, unknown>;
  } else if (options.full) {
    const prepared = prepareForPlanner(m, topK);
    state = (prepared.state ?? {}) as Record<string, unknown>;
    if (topK > 0) {
      for (const node of Object.values(m.state ?? {})) {
        if (
          node &&
          typeof node === 'object' &&
          'type' in node &&
          ((node as { type: string }).type === 'table' ||
            (node as { type: string }).type === 'array') &&
          Array.isArray((node as { value?: unknown[] }).value) &&
          (node as { value: unknown[] }).value.length > topK
        ) {
          truncated = true;
          break;
        }
      }
    }
  } else {
    const summarized = summarizeArrays(m, topK);
    state = (summarized.state ?? {}) as Record<string, unknown>;
    if (topK > 0) {
      for (const [key, node] of Object.entries(m.state ?? {})) {
        const before = node as { type?: string; value?: unknown[] };
        const after = summarized.state?.[key] as { value?: unknown[] } | undefined;
        if (
          before &&
          (before.type === 'table' || before.type === 'array') &&
          Array.isArray(before.value) &&
          after &&
          Array.isArray(after.value) &&
          after.value.length < before.value.length
        ) {
          truncated = true;
          break;
        }
      }
    }
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

/** Extract state_delta from applied diff ops (§5.2). */
export function stateDelta(
  diffOps: DiffDocument['diff'] | unknown[],
  postManifest: PageManifest,
): {
  state_delta: Record<string, unknown>;
  actions_delta: { added: string[]; removed: string[]; replaced: string[] };
} {
  const stateKeys = new Set<string>();
  const actionsDelta = { added: [] as string[], removed: [] as string[], replaced: [] as string[] };

  for (const op of diffOps as Array<{ op: string; path: string; value?: unknown }>) {
    const path = op.path ?? '';
    const stateMatch = /^\/state\/([^/]+)/.exec(path);
    if (stateMatch) {
      stateKeys.add(stateMatch[1]!);
      continue;
    }
    const actionMatch = /^\/actions\/([^/]+)/.exec(path);
    if (actionMatch) {
      const id = actionMatch[1]!;
      if (op.op === 'add') actionsDelta.added.push(id);
      else if (op.op === 'remove') actionsDelta.removed.push(id);
      else actionsDelta.replaced.push(id);
    }
  }

  const state_delta: Record<string, unknown> = {};
  for (const key of stateKeys) {
    if (key === 'present') continue;
    state_delta[key] =
      postManifest.state && key in postManifest.state
        ? (postManifest.state as Record<string, unknown>)[key]
        : null;
  }

  return { state_delta, actions_delta: actionsDelta };
}
