/**
 * Publish-time `options_source` checks (SPEC §10.2).
 * Target action MUST be kind query + side_effect safe.
 */

import { AppError } from './errors.js';
import type { ActionDef, ParamDef, ValidationFailure } from './types.js';

function fail(code: string, message: string, path?: string): ValidationFailure {
  return { code, message, path };
}

export interface OptionsSourceTarget {
  action: string;
  param: string;
  results_path: string;
  min_query_length?: number;
}

export function readOptionsSource(def: ParamDef): OptionsSourceTarget | null {
  const src = def.options_source;
  if (!src) return null;
  if (
    typeof src.action !== 'string' ||
    typeof src.param !== 'string' ||
    typeof src.results_path !== 'string'
  ) {
    return null;
  }
  return src;
}

/**
 * Publish-time validation of a ParamDef.options_source against the same-page actions map.
 * Returns a ValidationFailure if the pointer is broken; null if legal (or absent).
 */
export function validateOptionsSource(
  def: ParamDef,
  actions: Record<string, ActionDef> | undefined,
  path = '/actions',
): ValidationFailure | null {
  const src = def.options_source;
  if (!src) return null;

  if (def.type !== 'string' && def.type !== 'enum') {
    return fail(
      'app.err.action.options_source_invalid',
      'options_source is only legal on string or enum params',
      path,
    );
  }

  const target = actions?.[src.action];
  if (!target) {
    return fail(
      'app.err.action.options_source_invalid',
      `options_source action "${src.action}" does not exist on this page`,
      `${path}/options_source/action`,
    );
  }
  if (target.kind !== 'query' || (target.side_effect ?? 'safe') !== 'safe') {
    return fail(
      'app.err.action.options_source_invalid',
      'options_source target MUST be kind query with side_effect safe',
      `${path}/options_source/action`,
    );
  }
  if (target.idempotent === false) {
    return fail(
      'app.err.action.options_source_invalid',
      'options_source target MUST be idempotent',
      `${path}/options_source/action`,
    );
  }
  if (target.requires_confirmation) {
    return fail(
      'app.err.action.options_source_invalid',
      'options_source target MUST NOT require confirmation',
      `${path}/options_source/action`,
    );
  }
  const paramDef = target.input?.[src.param];
  if (!paramDef || paramDef.type !== 'string') {
    return fail(
      'app.err.action.options_source_invalid',
      `options_source param "${src.param}" MUST be a string param on the target action`,
      `${path}/options_source/param`,
    );
  }
  if (target.output?.state_diff !== true) {
    return fail(
      'app.err.action.options_source_invalid',
      'options_source target MUST declare output.state_diff true',
      `${path}/options_source/action`,
    );
  }
  return null;
}

/** Throw AppError when publish-time checks fail. */
export function assertValidOptionsSource(
  def: ParamDef,
  actions: Record<string, ActionDef> | undefined,
  path?: string,
): void {
  const err = validateOptionsSource(def, actions, path);
  if (err) {
    throw new AppError(err.code, { message: err.message, path: err.path });
  }
}

/**
 * Walk ActionDef.input and reject any broken options_source at publish time.
 * Servers MUST NOT emit the ActionDef when this fails.
 */
export function validateActionOptionsSources(
  actionId: string,
  actionDef: ActionDef,
  actions: Record<string, ActionDef>,
): ValidationFailure | null {
  const input = actionDef.input ?? {};
  for (const [key, def] of Object.entries(input)) {
    const err = validateOptionsSource(def, actions, `/actions/${actionId}/input/${key}`);
    if (err) return err;
  }
  return null;
}
