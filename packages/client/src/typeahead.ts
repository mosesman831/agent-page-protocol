/**
 * options_source typeahead (SPEC-v0.5-extreme §10).
 * Debounce; MUST NOT POST if query is shorter than min_query_length.
 */

import { AppError } from './errors.js';
import type { ActionDispatcher } from './actions.js';
import { findAction } from './actions.js';
import type { FeatureFlags, PageManifest, ParamDef } from './types.js';

export interface TypeaheadResult {
  sent: boolean;
  query: string;
  manifest?: PageManifest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function optionsSourceOf(
  manifest: PageManifest,
  actionId: string,
  paramName: string,
): NonNullable<ParamDef['options_source']> | null {
  const def = manifest.actions?.[actionId];
  const param = def?.input?.[paramName];
  if (!param?.options_source) return null;
  return param.options_source;
}

export function shouldSendTypeahead(query: string, minQueryLength: number): boolean {
  return query.length >= minQueryLength;
}

/**
 * Wait debounce_ms, then POST the options_source query action unless the
 * query is shorter than min_query_length (MUST NOT send).
 */
export async function typeahead(
  dispatcher: ActionDispatcher,
  manifest: PageManifest,
  actionId: string,
  paramName: string,
  query: string,
  options: {
    features?: FeatureFlags;
    debounceMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
    stale?: () => boolean;
  } = {},
): Promise<TypeaheadResult> {
  if (options.features && options.features.typeahead !== true) {
    return { sent: false, query };
  }
  const src = optionsSourceOf(manifest, actionId, paramName);
  if (!src) {
    throw new AppError('app.err.action.options_source_invalid', {
      message: `No options_source on ${actionId}.${paramName}`,
    });
  }
  const minLen = src.min_query_length ?? 1;
  if (!shouldSendTypeahead(query, minLen)) {
    return { sent: false, query };
  }
  const srcExtra = src as { debounce_ms?: number };
  const waitMs = options.debounceMs ?? srcExtra.debounce_ms ?? 200;
  const wait = options.sleepFn ?? sleep;
  if (waitMs > 0) await wait(waitMs);
  if (options.stale?.()) return { sent: false, query };

  const target = findAction(manifest, src.action);
  if (target.kind !== 'query' || (target.side_effect ?? 'safe') !== 'safe') {
    throw new AppError('app.err.action.options_source_invalid', {
      message: 'options_source target must be a safe query',
    });
  }
  const result = await dispatcher.invoke(manifest, src.action, { [src.param]: query });
  return { sent: true, query, manifest: result.manifest };
}

export class TypeaheadController {
  private seq = 0;

  constructor(private readonly dispatcher: ActionDispatcher) {}

  async query(
    manifest: PageManifest,
    actionId: string,
    paramName: string,
    q: string,
    options: { features?: FeatureFlags; debounceMs?: number } = {},
  ): Promise<TypeaheadResult> {
    const my = ++this.seq;
    return typeahead(this.dispatcher, manifest, actionId, paramName, q, {
      ...options,
      stale: () => this.seq !== my,
    });
  }
}
