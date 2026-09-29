/**
 * Human-verification hold (SPEC-v0.5-extreme §7, §25.1).
 * Client budget: 3 holds per task then app.err.hold.budget_exceeded.
 * Agents MUST NOT GET widget_url and MUST NOT invoke complete_hold.
 */

import { AppError } from './errors.js';
import { isStateNode, readNumberNode, readStringNode, unwrapStateNode } from './features.js';
import type { HoldKind, HoldObject, PageManifest, StateNode } from './types.js';

export const HOLD_BUDGET_PER_TASK = 3;

export interface HoldRequest {
  hold: HoldObject;
  actionId: string;
  params: Record<string, unknown>;
  manifest: PageManifest;
}

export type OnHold = (req: HoldRequest) => Promise<{ wait: boolean; abort?: boolean }>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

export function parseHoldObject(node: unknown): HoldObject | null {
  const map = nodeMap(node);
  if (!map) return null;
  const id = readStringNode(map.id);
  const kind = readStringNode(map.kind) as HoldKind | undefined;
  const verifyUrl = readStringNode(map.verify_url);
  if (!id || !kind || !verifyUrl) return null;
  const widget = readStringNode(map.widget_url);
  const ttl = readNumberNode(map.ttl_ms);
  const expires = readStringNode(map.expires_at);
  const issued = readNumberNode(map.issued_count);
  const status = readStringNode(map.status) as HoldObject['status'];
  const who = readStringNode(map.who) as HoldObject['who'];
  const resume = readStringNode(map.resume_action);
  const token = readStringNode(map.token);
  const hold: HoldObject = {
    id,
    kind,
    verify_url: verifyUrl,
    agent_solvable: false,
  };
  if (status) hold.status = status;
  if (who) hold.who = who;
  if (resume) hold.resume_action = resume;
  if (widget) hold.widget_url = widget;
  if (ttl !== undefined) hold.ttl_ms = ttl;
  if (expires) hold.expires_at = expires;
  if (issued !== undefined) hold.issued_count = issued;
  if (token) hold.token = token;
  return hold;
}

export function holdFromErrorDetails(
  details: Record<string, StateNode> | undefined,
): HoldObject | null {
  if (!details) return null;
  return parseHoldObject(details.hold);
}

export function holdFromManifest(manifest: PageManifest): HoldObject | null {
  return parseHoldObject(manifest.state?.human_hold) ?? parseHoldObject(manifest.state?.hold);
}

export function holdTokenOf(hold: HoldObject): string {
  const extra = hold as HoldObject & { token?: string };
  return extra.token || hold.id;
}

export class HoldBudget {
  private count = 0;

  get used(): number {
    return this.count;
  }

  record(): void {
    this.count += 1;
    if (this.count > HOLD_BUDGET_PER_TASK) {
      throw new AppError('app.err.hold.budget_exceeded', {
        message: `Client hold budget exceeded (${HOLD_BUDGET_PER_TASK} per task)`,
      });
    }
  }

  reset(): void {
    this.count = 0;
  }
}

export function assertNotCompleteHold(actionId: string): void {
  if (actionId === 'complete_hold') {
    throw new AppError('app.err.hold.invalid', {
      message: 'Agents must not invoke complete_hold',
    });
  }
}

/**
 * onHold missing / abort -> hold.unattended. Never fetches widget_url.
 * `wait:true` returns so the caller can poll the same-origin verify_url.
 */
export async function collectHold(
  onHold: OnHold | undefined,
  req: HoldRequest,
): Promise<{ wait: boolean; token: string }> {
  if (!onHold) {
    throw new AppError('app.err.hold.unattended', {
      message: 'No onHold callback registered',
    });
  }
  const result = await onHold(req);
  if (result.abort || result.wait !== true) {
    if (result.abort || result.wait === false) {
      if (result.abort) {
        throw new AppError('app.err.hold.unattended', {
          message: 'Hold aborted',
        });
      }
      return { wait: false, token: holdTokenOf(req.hold) };
    }
  }
  return { wait: result.wait === true, token: holdTokenOf(req.hold) };
}

export function holdPollIntervalMs(hold: HoldObject): number {
  const ttl = hold.ttl_ms ?? 300_000;
  return Math.min(5_000, Math.max(1_000, Math.floor(ttl / 60) || 2_000));
}

export function holdDeadlineMs(hold: HoldObject, serverTime?: string): number {
  if (hold.expires_at) {
    const exp = Date.parse(hold.expires_at);
    if (!Number.isNaN(exp)) {
      const now = serverTime ? Date.parse(serverTime) : Date.now();
      const base = Number.isNaN(now) ? Date.now() : now;
      return Math.max(0, exp - base);
    }
  }
  return hold.ttl_ms ?? 300_000;
}

export { sleep as holdSleep };
