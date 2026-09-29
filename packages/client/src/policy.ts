/**
 * ActionPolicy — side_effect gates L0–L4 (SPEC §10.4, §10.7).
 */

import { AppError } from './errors.js';
import type {
  ActionDef,
  ConfirmationRequest,
  PageManifest,
  SideEffect,
  StateNode,
} from './types.js';

export type PolicyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface ActionPolicyOptions {
  /** Allowed side effects without interactive approval. Default: ['safe']. */
  autoAllow?: SideEffect[];
  /** Max financial amount auto-approved (same unit). */
  maxFinancial?: { value: number; unit?: string };
  /** Required scopes the agent holds. */
  scopes?: string[];
  /** When true, never speculative-execute financial/identity/destructive (§15.6). */
  neverSpeculate?: boolean;
  /** Purpose ids the agent must never grant. Default: marketing. */
  deniedConsentPurposes?: string[];
  /** When true, kind:delegate https is allowed (still requires onDelegate). */
  allowDelegate?: boolean;
  /** Action kinds the client MUST refuse outright (SPEC §5.4 error catalog). */
  forbiddenKinds?: ActionDef['kind'][];
}

export function policyLevelFor(actionDef: ActionDef): PolicyLevel {
  if (actionDef.requires_confirmation) return 'L4';
  const se = actionDef.side_effect ?? 'safe';
  if (se === 'destructive') return 'L1';
  if (se === 'financial') return 'L2';
  if (se === 'identity') return 'L3';
  return 'L0';
}

export function readAmountFromState(
  manifest: PageManifest,
  amountPath: string | undefined,
): { value: number; unit?: string; scale?: number; path?: string } | undefined {
  if (!amountPath) return undefined;
  // amount_path is relative to state root, e.g. "price" or "fare/total"
  const parts = amountPath
    .replace(/^\//, '')
    .replace(/^state\//, '')
    .split('/')
    .filter(Boolean);
  let cur: unknown = manifest.state;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    if ('type' in (cur as object) && (cur as StateNode).type === 'object') {
      cur = (cur as { value: Record<string, StateNode> }).value?.[p];
    } else {
      cur = (cur as Record<string, unknown>)[p];
    }
  }
  if (cur && typeof cur === 'object' && (cur as StateNode).type === 'number') {
    const n = cur as { value: number; unit?: string; scale?: number };
    return { value: n.value, unit: n.unit, scale: n.scale, path: amountPath };
  }
  return undefined;
}

export class ActionPolicy {
  private readonly autoAllow: Set<SideEffect>;
  private readonly maxFinancial?: { value: number; unit?: string };
  private readonly scopes: Set<string>;
  readonly neverSpeculate: boolean;
  readonly deniedConsentPurposes: ReadonlySet<string>;
  readonly allowDelegate: boolean;
  private readonly forbiddenKinds: Set<ActionDef['kind']>;

  constructor(options: ActionPolicyOptions = {}) {
    this.autoAllow = new Set(options.autoAllow ?? ['safe']);
    this.maxFinancial = options.maxFinancial;
    this.scopes = new Set(options.scopes ?? []);
    this.neverSpeculate = options.neverSpeculate ?? true;
    this.deniedConsentPurposes = new Set(options.deniedConsentPurposes ?? ['marketing']);
    this.allowDelegate = options.allowDelegate === true;
    this.forbiddenKinds = new Set(options.forbiddenKinds ?? []);
  }

  checkScopes(actionDef: ActionDef): void {
    const policy = actionDef.policy as { scopes?: string[] } | undefined;
    if (!policy?.scopes?.length) return;
    if (this.scopes.size === 0) return; // no scope awareness configured
    for (const required of policy.scopes) {
      if (!this.scopes.has(required)) {
        throw new AppError('app.err.auth.insufficient_scope', {
          message: `Missing scope: ${required}`,
          httpStatus: 403,
        });
      }
    }
  }

  /**
   * Returns whether the action may auto-execute, or a ConfirmationRequest.
   */
  evaluate(
    actionId: string,
    actionDef: ActionDef,
    params: Record<string, unknown>,
    manifest: PageManifest,
  ): { allowed: true } | { allowed: false; confirmation: ConfirmationRequest } {
    this.checkScopes(actionDef);
    if (this.forbiddenKinds.has(actionDef.kind)) {
      throw new AppError('app.err.action.forbidden_kind', {
        message: `Action kind '${actionDef.kind}' blocked by client policy`,
        path: `/actions/${actionId}/kind`,
      });
    }
    if (actionId === 'complete_hold') {
      this.deny(actionId, 'Agents must not invoke complete_hold');
    }
    if (actionDef.kind === 'delegate' && !this.allowDelegate) {
      const proto = actionDef.output?.delegate_protocol;
      if (proto === 'https' || actionDef.output?.delegates_to) {
        return {
          allowed: false,
          confirmation: {
            actionId,
            actionDef,
            params,
            manifest,
            level: 'L3',
          },
        };
      }
    }
    const level = policyLevelFor(actionDef);
    const sideEffect = actionDef.side_effect ?? 'safe';

    if (level === 'L0' && this.autoAllow.has(sideEffect)) {
      return { allowed: true };
    }

    // L2 financial max check — still needs confirmation unless under max AND auto-allowed
    const amount = readAmountFromState(manifest, actionDef.confirm?.amount_path);
    if (
      level === 'L2' &&
      this.maxFinancial &&
      amount &&
      amount.value <= this.maxFinancial.value &&
      (!this.maxFinancial.unit || !amount.unit || amount.unit === this.maxFinancial.unit) &&
      this.autoAllow.has('financial')
    ) {
      return { allowed: true };
    }

    if (
      this.neverSpeculate &&
      (sideEffect === 'financial' || sideEffect === 'identity' || sideEffect === 'destructive')
    ) {
      return {
        allowed: false,
        confirmation: {
          actionId,
          actionDef,
          params,
          manifest,
          level: level === 'L0' ? 'L4' : level,
          amount,
        },
      };
    }

    if (level === 'L0') {
      return { allowed: true };
    }

    return {
      allowed: false,
      confirmation: {
        actionId,
        actionDef,
        params,
        manifest,
        level,
        amount,
      },
    };
  }

  deny(actionId: string, reason?: string): never {
    throw new AppError('app.err.policy.denied', {
      message: reason ?? `Policy denied action: ${actionId}`,
    });
  }
}

export function requiresIdempotencyKey(actionDef: ActionDef): boolean {
  const se = actionDef.side_effect ?? 'safe';
  if (se === 'financial' || se === 'destructive' || se === 'identity') return true;
  if (actionDef.idempotent === false) return true;
  return false;
}

export function isIdempotentAction(actionDef: ActionDef): boolean {
  if (actionDef.idempotent === true) return true;
  if (actionDef.idempotent === false) return false;
  // Default: queries are idempotent; others not unless marked
  return actionDef.kind === 'query' && (actionDef.side_effect ?? 'safe') === 'safe';
}
