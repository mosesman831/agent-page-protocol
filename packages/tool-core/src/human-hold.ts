/**
 * Persist hold.human_required; REFUSE complete_hold; budget 3;
 * resume via X-APP-Hold-Token (CLIENT-TOOL-CONTRACT §6.5, SPEC §7).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@agent-page/client';
import { HEADER_APP_HOLD_TOKEN, HUMAN_HOLD_BUDGET } from './types.js';
import type { HoldFile } from './types.js';
import { HoldStore, decodeRawBodyString } from './holds.js';
import { SessionStore, atomicWrite } from './session-store.js';

export const COMPLETE_HOLD_ACTION = 'complete_hold';

export function isCompleteHoldAction(actionId: string): boolean {
  return actionId === COMPLETE_HOLD_ACTION;
}

/** Agents MUST NOT POST complete_hold (TV-91), even with publisher arrangement. */
export function refuseCompleteHold(actionId: string): void {
  if (isCompleteHoldAction(actionId)) {
    throw new AppError('app.err.hold.invalid', {
      message: 'Agents must not POST complete_hold',
    });
  }
}

export function refuseHumanVerificationChallengeSubmit(kind: string): void {
  if (kind === 'human_verification' || kind === 'captcha' || kind === 'liveness') {
    throw new AppError('app.err.hold.invalid', {
      message:
        'challenge submit --kind human_verification is rejected; a Renderer must clear the hold',
    });
  }
}

export function assertNotWidgetFetch(url: string, widgetUrl: string | undefined | null): void {
  if (widgetUrl && url === widgetUrl) {
    throw new AppError('app.err.hold.invalid', {
      message: 'Agents MUST NOT GET widget_url',
    });
  }
}

function budgetPath(store: SessionStore): string {
  return join(store.holdsDir, '.budget.json');
}

function readBudget(store: SessionStore): Record<string, number> {
  const path = budgetPath(store);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeBudget(store: SessionStore, data: Record<string, number>): void {
  store.ensureHome();
  atomicWrite(budgetPath(store), JSON.stringify(data) + '\n', 0o600);
}

export function humanHoldCount(store: SessionStore, origin: string): number {
  return readBudget(store)[origin] ?? 0;
}

/**
 * Increment per-origin task counter. After 3 holds, abort (TV-94: no 4th retry).
 */
export function incrementHumanHoldBudget(store: SessionStore, origin: string): number {
  const data = readBudget(store);
  const next = (data[origin] ?? 0) + 1;
  if (next > HUMAN_HOLD_BUDGET) {
    throw new AppError('app.err.hold.budget_exceeded', {
      message: `Human verification budget exceeded for ${origin}`,
    });
  }
  data[origin] = next;
  writeBudget(store, data);
  return next;
}

export function resetHumanHoldBudget(store: SessionStore, origin?: string): void {
  if (!origin) {
    writeBudget(store, {});
    return;
  }
  const data = readBudget(store);
  delete data[origin];
  writeBudget(store, data);
}

export function extractHumanHold(details: Record<string, unknown> | undefined): {
  id?: string;
  verify_url?: string;
  widget_url?: string;
  ttl_ms?: number;
  issued_count?: number;
} {
  if (!details) return {};
  const raw = details.hold;
  let obj: Record<string, unknown> | null = null;
  if (raw && typeof raw === 'object' && (raw as { type?: string }).type === 'object') {
    const inner = (raw as { value?: unknown }).value;
    if (inner && typeof inner === 'object') obj = inner as Record<string, unknown>;
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return {};
  const val = (k: string): unknown => {
    const v = obj![k];
    if (v && typeof v === 'object' && 'value' in (v as object))
      return (v as { value: unknown }).value;
    return v;
  };
  return {
    id: typeof val('id') === 'string' ? String(val('id')) : undefined,
    verify_url: typeof val('verify_url') === 'string' ? String(val('verify_url')) : undefined,
    widget_url: typeof val('widget_url') === 'string' ? String(val('widget_url')) : undefined,
    ttl_ms: typeof val('ttl_ms') === 'number' ? (val('ttl_ms') as number) : undefined,
    issued_count:
      typeof val('issued_count') === 'number' ? (val('issued_count') as number) : undefined,
  };
}

export function holdTokenHeaders(file: HoldFile): Record<string, string> {
  const token =
    file.hold_token ??
    file.gates.find((g) => g.kind === 'hold' && g.hold_token)?.hold_token ??
    null;
  if (!token) return {};
  return { [HEADER_APP_HOLD_TOKEN]: token };
}

export function originalBodyForResume(file: HoldFile): string {
  return decodeRawBodyString(file.raw_body_b64);
}

export function persistHumanHold(
  holds: HoldStore,
  input: Parameters<HoldStore['persist']>[0] & { origin: string },
): HoldFile {
  refuseCompleteHold(input.action);
  incrementHumanHoldBudget(holds.store, input.origin);
  return holds.persist({
    ...input,
    kind: 'human_verification',
  });
}

export { HoldStore };
