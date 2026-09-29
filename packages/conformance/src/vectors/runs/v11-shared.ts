/**
 * Shared helpers for the TV-61..TV-140 runners (SPEC §27).
 */

import type { VectorContext } from '../types.js';
import { pass, fail } from '../types.js';
import { v11ActionHeaders } from '../helpers.js';
import { V11_FEATURE_FLAGS } from '../../server/fixtures.js';

type Run = (ctx: VectorContext) => Promise<ReturnType<typeof pass>>;

export function wrap(id: string, fn: (ctx: VectorContext) => Promise<string>): Run {
  return async (ctx) => {
    try {
      const msg = await fn(ctx);
      return pass(id, msg);
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  };
}

function featuresFromWellKnown(body: {
  state?: {
    features?: { value?: Record<string, { value?: boolean }> };
    protocol_version?: { value?: string };
  };
}): Record<string, boolean> {
  const raw = body.state?.features?.value ?? {};
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(V11_FEATURE_FLAGS)) out[k] = false;
  for (const [k, n] of Object.entries(raw)) out[k] = Boolean(n?.value);
  return out;
}

export function discover11(manifest: {
  app?: string;
  state?: {
    features?: { value?: Record<string, { value?: boolean }> };
    protocol_version?: { value?: string };
  };
}): { selected: string; features: Record<string, boolean>; wouldSendChallenge: boolean } {
  const proto = manifest.state?.protocol_version?.value;
  const selected =
    manifest.app === '1.1' || proto === '1.1' ? (manifest.app === '1.0' ? '1.0' : '1.1') : '1.0';
  const hasFeatures = manifest.state?.features != null;
  if (selected === '1.0' || !hasFeatures) {
    const features: Record<string, boolean> = {};
    for (const k of Object.keys(V11_FEATURE_FLAGS)) features[k] = false;
    return { selected: '1.0', features, wouldSendChallenge: false };
  }
  return { selected: '1.1', features: featuresFromWellKnown(manifest), wouldSendChallenge: true };
}

export async function postAction(
  ctx: VectorContext,
  path: string,
  action: string,
  params: Record<string, unknown>,
  extra: Record<string, string> = {},
): Promise<Response> {
  return ctx.fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: v11ActionHeaders(ctx, extra),
    body: JSON.stringify({ app: '1.1', action, params }),
  });
}
