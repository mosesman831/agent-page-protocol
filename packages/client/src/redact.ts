/**
 * Redact secret:true StateNodes and Authorization headers for logs (§10.5, §15.7).
 */

import type { ArrayStateNode, PageManifest, StateNode, TableStateNode } from './types.js';

const REDACTED = '[REDACTED]';

function isStateNode(value: unknown): value is StateNode {
  return !!value && typeof value === 'object' && 'type' in (value as object);
}

function redactNode(node: StateNode): StateNode {
  if (node.type === 'string' && (node as { secret?: boolean }).secret === true) {
    return { ...node, value: REDACTED };
  }
  if (node.type === 'array' && Array.isArray(node.value)) {
    return {
      ...node,
      value: node.value.map((child) => (isStateNode(child) ? redactNode(child) : child)),
    };
  }
  if (node.type === 'object' && node.value && typeof node.value === 'object') {
    const out: Record<string, StateNode> = {};
    for (const [k, v] of Object.entries(node.value as Record<string, StateNode>)) {
      out[k] = isStateNode(v) ? redactNode(v) : v;
    }
    return { ...node, value: out };
  }
  return node;
}

/** Deep-clone a manifest with secret string values replaced. */
export function redactSecrets(manifest: PageManifest): PageManifest {
  const clone = structuredClone(manifest) as PageManifest;
  for (const [k, v] of Object.entries(clone.state ?? {})) {
    if (isStateNode(v)) clone.state[k] = redactNode(v);
  }
  if (clone.error?.details) {
    const details: Record<string, StateNode> = {};
    for (const [k, v] of Object.entries(clone.error.details)) {
      details[k] = isStateNode(v) ? redactNode(v) : v;
    }
    clone.error.details = details;
  }
  return clone;
}

/** Redact Authorization / Cookie / API key style headers for logging. */
export function redactHeaders(
  headers: Record<string, string | undefined> | Headers,
): Record<string, string> {
  const out: Record<string, string> = {};
  const entries: Array<[string, string]> = [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      entries.push([key, value]);
    });
  } else {
    for (const [key, value] of Object.entries(headers as Record<string, string | undefined>)) {
      if (value !== undefined) entries.push([key, value]);
    }
  }

  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'cookie' ||
      lower === 'set-cookie' ||
      lower === 'x-api-key' ||
      lower === 'x-app-confirmation' ||
      lower === 'x-app-csrf' ||
      lower === 'x-app-resume' ||
      lower === 'set-app-resume' ||
      lower === 'x-app-access-token' ||
      lower === 'x-app-refresh-token' ||
      lower === 'x-app-challenge' ||
      lower === 'x-app-hold-token'
    ) {
      out[key] = REDACTED;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Strip `/present` and redact secrets for LLM context (§15.7 token budget hygiene).
 */
export function stripForLlm(manifest: PageManifest): Omit<PageManifest, 'present'> {
  const redacted = redactSecrets(manifest);
  const { present: _present, ...rest } = redacted;
  return rest;
}

/**
 * Summarize long arrays: keep top-K items + total when available (§15.7).
 */
export function summarizeArrays(manifest: PageManifest, topK = 5): PageManifest {
  const clone = structuredClone(manifest) as PageManifest;
  for (const [key, node] of Object.entries(clone.state ?? {})) {
    if (node.type === 'array' && Array.isArray((node as ArrayStateNode).value)) {
      const arr = node as ArrayStateNode;
      if (arr.value.length <= topK) continue;
      const pagination = arr.pagination;
      const totalResults = clone.state.total_results;
      const total =
        pagination?.total ??
        (totalResults && totalResults.type === 'number'
          ? (totalResults as { value: number }).value
          : arr.value.length);
      clone.state[key] = {
        ...arr,
        value: arr.value.slice(0, topK),
        pagination: {
          cursor: pagination?.cursor ?? null,
          has_more: true,
          total: typeof total === 'number' ? total : arr.value.length,
        },
      };
      (clone.state[key] as StateNode & { _truncated?: boolean })._truncated = true;
    }
    if (node.type === 'table' && Array.isArray((node as TableStateNode).value)) {
      const table = node as TableStateNode;
      if (table.value.length <= topK) continue;
      const pagination = table.pagination;
      const total = pagination?.total ?? table.value.length;
      clone.state[key] = {
        ...table,
        value: table.value.slice(0, topK),
        pagination: {
          cursor: pagination?.cursor ?? null,
          has_more: true,
          total: typeof total === 'number' ? total : table.value.length,
        },
      };
    }
  }
  return clone;
}

const PLANNER_SECRET_KEYS = new Set([
  'otp',
  'password',
  'credential',
  'widget_response',
  'access_token',
  'refresh_token',
  'resume_token',
]);

function collectSecretParamNames(manifest: PageManifest): Set<string> {
  const names = new Set(PLANNER_SECRET_KEYS);
  for (const def of Object.values(manifest.actions ?? {})) {
    const secrets = (def.policy as { secret_params?: unknown } | undefined)?.secret_params;
    if (Array.isArray(secrets)) {
      for (const s of secrets) {
        if (typeof s === 'string') names.add(s);
      }
    }
  }
  return names;
}

function redactPlannerNode(node: StateNode, secretKeys: Set<string>, key?: string): StateNode {
  if (key && secretKeys.has(key) && node.type === 'string') {
    return { ...node, value: REDACTED };
  }
  if (node.type === 'string' && (node as { secret?: boolean }).secret === true) {
    return { ...node, value: REDACTED };
  }
  if (node.type === 'array' && Array.isArray(node.value)) {
    return {
      ...node,
      value: node.value.map((child) =>
        isStateNode(child) ? redactPlannerNode(child, secretKeys) : child,
      ),
    };
  }
  if (node.type === 'object' && node.value && typeof node.value === 'object') {
    const out: Record<string, StateNode> = {};
    for (const [k, v] of Object.entries(node.value as Record<string, StateNode>)) {
      out[k] = isStateNode(v) ? redactPlannerNode(v, secretKeys, k) : v;
    }
    return { ...node, value: out };
  }
  return node;
}

/**
 * Strip secret_params values and OTP codes from planner context (§25.3).
 * Order totals (integer + scale) are preserved.
 */
export function redactSecretParams(manifest: PageManifest): PageManifest {
  const clone = structuredClone(manifest) as PageManifest;
  const names = collectSecretParamNames(clone);
  for (const [k, v] of Object.entries(clone.state ?? {})) {
    if (isStateNode(v)) clone.state[k] = redactPlannerNode(v, names, k);
  }
  if (clone.error?.details) {
    const details: Record<string, StateNode> = {};
    for (const [k, v] of Object.entries(clone.error.details)) {
      details[k] = isStateNode(v) ? redactPlannerNode(v, names, k) : v;
    }
    clone.error.details = details;
  }
  return clone;
}

/** Full token-budget hygiene: strip present, redact secrets, summarize arrays. */
export function prepareForPlanner(manifest: PageManifest, topK = 5): Omit<PageManifest, 'present'> {
  return stripForLlm(summarizeArrays(redactSecretParams(manifest), topK));
}

export { REDACTED };
