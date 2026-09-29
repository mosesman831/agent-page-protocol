/**
 * Bulk operations (SPEC §15). all_or_nothing vs best_effort. Hard max 50 items.
 */

import { AppError } from './errors.js';
import type { ActionDef, SideEffect, ValidationFailure } from './types.js';

export const BULK_MAX_ITEMS = 50;

export type BulkMode = 'all_or_nothing' | 'best_effort';

export function defaultBulkMode(sideEffect: SideEffect | undefined): BulkMode {
  const side = sideEffect ?? 'safe';
  if (side === 'destructive' || side === 'financial' || side === 'identity') {
    return 'all_or_nothing';
  }
  return 'best_effort';
}

export function resolveBulkMode(actionDef: ActionDef): BulkMode {
  return actionDef.bulk?.mode ?? defaultBulkMode(actionDef.side_effect);
}

export function resolveBulkMaxItems(actionDef: ActionDef): number {
  const advertised = actionDef.bulk?.max_items;
  if (typeof advertised === 'number' && Number.isInteger(advertised) && advertised > 0) {
    return Math.min(advertised, BULK_MAX_ITEMS);
  }
  return BULK_MAX_ITEMS;
}

function fail(code: string, message: string, path?: string): ValidationFailure {
  return { code, message, path };
}

export interface ValidateBulkOptions {
  /** features.bulk_actions advertised on well-known. */
  featureEnabled: boolean;
  actionDef?: ActionDef;
  path?: string;
}

export type BulkValidationResult =
  | { ok: true; items: unknown[]; mode: BulkMode; maxItems: number }
  | { ok: false; error: ValidationFailure };

/**
 * Validate a bulk `params.items` payload.
 * Without bulk_actions feature => 400 feature.unsupported.
 */
export function validateBulkItems(
  items: unknown,
  options: ValidateBulkOptions,
): BulkValidationResult {
  if (!options.featureEnabled) {
    return {
      ok: false,
      error: fail(
        'app.err.feature.unsupported',
        'Bulk actions require features.bulk_actions',
        options.path ?? '/params/items',
      ),
    };
  }
  if (!Array.isArray(items)) {
    return {
      ok: false,
      error: fail(
        'app.err.validation.param_type',
        'params.items must be an array',
        options.path ?? '/params/items',
      ),
    };
  }
  const maxItems = options.actionDef ? resolveBulkMaxItems(options.actionDef) : BULK_MAX_ITEMS;
  if (items.length < 1 || items.length > maxItems) {
    return {
      ok: false,
      error: fail(
        'app.err.validation.param_range',
        `Bulk items must be 1..${maxItems} (hard cap ${BULK_MAX_ITEMS})`,
        options.path ?? '/params/items',
      ),
    };
  }
  const mode = options.actionDef ? resolveBulkMode(options.actionDef) : defaultBulkMode(undefined);
  return { ok: true, items, mode, maxItems };
}

export function assertBulkAllowed(featureEnabled: boolean): void {
  if (!featureEnabled) {
    throw new AppError('app.err.feature.unsupported', {
      message: 'Bulk actions require features.bulk_actions',
      path: '/params/items',
    });
  }
}

export interface BulkItemResult {
  id?: string;
  ok: boolean;
  code: string;
}

/**
 * Run item handlers. all_or_nothing stops and reports no partial commit on first failure.
 * best_effort continues and may return mixed results.
 */
export async function runBulk<T>(opts: {
  mode: BulkMode;
  items: T[];
  runOne: (item: T, index: number) => Promise<BulkItemResult> | BulkItemResult;
}): Promise<{ ok: boolean; partial: boolean; results: BulkItemResult[] }> {
  const results: BulkItemResult[] = [];
  if (opts.mode === 'all_or_nothing') {
    for (let i = 0; i < opts.items.length; i++) {
      const r = await opts.runOne(opts.items[i]!, i);
      results.push(r);
      if (!r.ok) {
        return { ok: false, partial: false, results };
      }
    }
    return { ok: true, partial: false, results };
  }

  let anyFail = false;
  let anyOk = false;
  for (let i = 0; i < opts.items.length; i++) {
    const r = await opts.runOne(opts.items[i]!, i);
    results.push(r);
    if (r.ok) anyOk = true;
    else anyFail = true;
  }
  return { ok: !anyFail, partial: anyFail && anyOk, results };
}
