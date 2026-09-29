import type { PageManifest, StateNode } from '@agent-page/client';

export function capabilitiesFromWellKnown(manifest: PageManifest | null | undefined): string[] {
  if (!manifest?.state) return [];
  const node = manifest.state.capabilities as StateNode | undefined;
  if (!node) return [];
  if (node.type === 'array' && Array.isArray(node.value)) {
    return node.value
      .map((n) => {
        if (n && typeof n === 'object' && 'type' in n && (n as StateNode).type === 'string') {
          return String((n as { value: string }).value);
        }
        if (typeof n === 'string') return n;
        return null;
      })
      .filter((x): x is string => !!x);
  }
  return [];
}

export function featuresFromWellKnown(
  manifest: PageManifest | null | undefined,
): Record<string, boolean> {
  if (!manifest?.state) return {};
  const node = manifest.state.features as StateNode | undefined;
  if (!node || node.type !== 'object' || !node.value) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(node.value as Record<string, StateNode>)) {
    if (v && typeof v === 'object' && v.type === 'boolean') {
      out[k] = !!v.value;
    }
  }
  return out;
}

export function siteNameFromWellKnown(manifest: PageManifest | null | undefined): string | null {
  const node = manifest?.state?.site_name as StateNode | undefined;
  if (node && node.type === 'string') return String(node.value);
  return manifest?.page?.title ?? null;
}

export function entryUrlsFromWellKnown(
  manifest: PageManifest | null | undefined,
): Record<string, string> {
  const node = manifest?.state?.entry_urls as StateNode | undefined;
  if (!node || node.type !== 'object' || !node.value) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.value as Record<string, StateNode>)) {
    if (v && typeof v === 'object' && v.type === 'string') {
      out[k] = String(v.value);
    }
  }
  return out;
}

/** Unknown auth treated as user (§D-9). */
export function normalizeAuth(auth: string | undefined): string {
  if (!auth) return 'none';
  if (auth === 'none' || auth === 'session' || auth === 'user' || auth === 'cookie') return auth;
  return 'user';
}
