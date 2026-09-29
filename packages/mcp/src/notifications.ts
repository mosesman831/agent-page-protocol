/**
 * Server -> client custom notification helpers (§10.17).
 */

import type { ToolEnvelope } from './runtime.js';

export type NotifyFn = (method: string, params?: Record<string, unknown>) => void;

export function notifyHold(notify: NotifyFn, session: string, hold: Record<string, unknown>): void {
  notify('notifications/app/hold', { session, hold });
}

export function notifyEvent(notify: NotifyFn, envelope: ToolEnvelope): void {
  notify('notifications/app/event', envelope as unknown as Record<string, unknown>);
}

export function notifyAsync(
  notify: NotifyFn,
  session: string,
  state: unknown,
  progress: unknown,
): void {
  notify('notifications/app/async', { session, state, progress });
}

export function notifyResourcesListChanged(notify: NotifyFn): void {
  notify('notifications/resources/list_changed', {});
}

export function notifyResourcesUpdated(notify: NotifyFn, uri: string): void {
  notify('notifications/resources/updated', { uri });
}

export function notifyToolsListChanged(notify: NotifyFn): void {
  notify('notifications/tools/list_changed', {});
}
