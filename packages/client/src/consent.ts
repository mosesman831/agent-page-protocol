/**
 * Consent grant helper (SPEC-v0.5-extreme §8, §25.1).
 */

import { AppError } from './errors.js';
import { isStateNode, readBooleanNode, readStringNode, unwrapStateNode } from './features.js';
import type { PageManifest, StateNode } from './types.js';

export const DEFAULT_DENIED_PURPOSES = ['marketing'] as const;

export interface ConsentPurpose {
  id: string;
  granted: boolean;
  required?: boolean;
  label?: string;
}

export interface ConsentState {
  version?: string;
  required: boolean;
  purposes: ConsentPurpose[];
}

export interface ConsentRequest {
  version?: string;
  purposes: ConsentPurpose[];
  missing?: string[];
  manifest: PageManifest;
}

export type OnConsent = (
  req: ConsentRequest,
) => Promise<{ purposes: { id: string; granted: boolean }[] } | { abort: true }>;

function nodeMap(node: unknown): Record<string, unknown> | null {
  if (isStateNode(node) && node.type === 'object') {
    return ((node as { value?: Record<string, StateNode> }).value ?? {}) as Record<string, unknown>;
  }
  const unwrapped = unwrapStateNode(node);
  if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
    return unwrapped as Record<string, unknown>;
  }
  return null;
}

export function parseConsent(manifest: PageManifest): ConsentState | null {
  const node = manifest.state?.consent;
  const map = nodeMap(node);
  if (!map) return null;
  const version = readStringNode(map.version);
  const required = readBooleanNode(map.required) === true;
  const purposesRaw = unwrapStateNode(map.purposes);
  const purposes: ConsentPurpose[] = [];
  if (Array.isArray(purposesRaw)) {
    for (const item of purposesRaw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id : undefined;
      if (!id) continue;
      purposes.push({
        id,
        granted: rec.granted === true,
        required: rec.required === true,
        label: typeof rec.label === 'string' ? rec.label : undefined,
      });
    }
  }
  return { version, required, purposes };
}

export function missingConsentPurposes(details: Record<string, StateNode> | undefined): string[] {
  if (!details?.missing) return [];
  const raw = unwrapStateNode(details.missing);
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

export function filterGrantPurposes(
  purposes: { id: string; granted: boolean }[],
  denied: readonly string[] = DEFAULT_DENIED_PURPOSES,
): { id: string; granted: boolean }[] {
  const deniedSet = new Set(denied);
  return purposes.map((p) => {
    if (p.id === 'necessary') return { id: p.id, granted: true };
    if (deniedSet.has(p.id) && p.granted) return { id: p.id, granted: false };
    return p;
  });
}

export async function collectConsent(
  onConsent: OnConsent | undefined,
  req: ConsentRequest,
  denied: readonly string[] = DEFAULT_DENIED_PURPOSES,
): Promise<{ id: string; granted: boolean }[]> {
  if (!onConsent) {
    throw new AppError('app.err.consent.required', {
      message: 'Consent required and no onConsent callback registered',
    });
  }
  const result = await onConsent(req);
  if ('abort' in result && result.abort) {
    throw new AppError('app.err.consent.required', {
      message: 'Consent grant aborted',
    });
  }
  if (!('purposes' in result)) {
    throw new AppError('app.err.consent.required', {
      message: 'Consent grant aborted',
    });
  }
  // §5.8: a grant for a purpose the page never declared is rejected
  // client-side as consent.unknown_purpose (the server rejects it too).
  const declared = new Set(req.purposes.map((p) => p.id));
  for (const p of result.purposes) {
    if (!declared.has(p.id)) {
      throw new AppError('app.err.consent.unknown_purpose', {
        message: `Unknown consent purpose: ${p.id}`,
        path: `/purposes/${p.id}`,
      });
    }
  }
  return filterGrantPurposes(result.purposes, denied);
}

export function buildGrantParams(purposes: { id: string; granted: boolean }[]): {
  purposes: { id: string; granted: boolean }[];
} {
  return { purposes };
}
