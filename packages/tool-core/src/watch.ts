/**
 * Poll loop; uses public ActionDispatcher.pollAsyncOperation (K3 MF-7).
 * Interval floor 1000 ms (CLIENT-TOOL-CONTRACT D-7 / §7.5).
 */

import {
  type AgentClient,
  type AppHttpClient,
  type InvokeOptions,
  type PageManifest,
} from '@agent-page/client';
import { WATCH_INTERVAL_DEFAULT_MS, WATCH_INTERVAL_FLOOR_MS, type WatchResult } from './types.js';
import { selectWatchTransport, type WatchTransport } from './events.js';
import type { FeatureFlags } from './capabilities.js';

export function floorIntervalMs(
  ms: number | undefined,
  fallback = WATCH_INTERVAL_DEFAULT_MS,
): number {
  return Math.max(WATCH_INTERVAL_FLOOR_MS, ms ?? fallback);
}

export function intervalFromManifest(
  manifest: PageManifest | undefined,
  override?: number,
): number {
  const hint =
    typeof manifest?.meta?.refresh_hint_ms === 'number'
      ? (manifest.meta.refresh_hint_ms as number)
      : undefined;
  return floorIntervalMs(override ?? hint, WATCH_INTERVAL_DEFAULT_MS);
}

export interface WatchOnceResult {
  transport: WatchTransport;
  changed: boolean;
  interval_ms: number;
  last_event_id: string | null;
  status: number;
  etag: string | null;
  manifest?: PageManifest | null;
  body?: unknown;
}

/**
 * Single conditional GET. 304 -> not_modified; 200 -> changed.
 */
export async function watchOnce(
  http: AppHttpClient,
  url: string,
  opts: {
    etag?: string | null;
    intervalMs?: number;
    refreshHintMs?: number;
    features?: FeatureFlags;
    sse?: boolean;
    ws?: boolean;
    lastEventId?: string | null;
  } = {},
): Promise<WatchOnceResult> {
  const interval_ms = floorIntervalMs(opts.intervalMs ?? opts.refreshHintMs);
  const transport = selectWatchTransport(opts.features, { sse: opts.sse, ws: opts.ws });
  if (transport === 'sse' && !opts.sse) {
    /* still poll for --once */
  }
  const { meta, body } = await http.get(url, {
    ifNoneMatch: opts.etag ?? undefined,
    pageUrl: url,
  });
  const changed = meta.status !== 304;
  return {
    transport: 'poll',
    changed,
    interval_ms,
    last_event_id: opts.lastEventId ?? null,
    status: meta.status,
    etag: meta.etag,
    manifest: changed && body && typeof body === 'object' ? (body as PageManifest) : null,
    body,
  };
}

export function watchResultFromOnce(once: WatchOnceResult): WatchResult {
  return {
    transport: once.transport,
    changed: once.changed,
    subscription_id: null,
    interval_ms: once.interval_ms,
    last_event_id: once.last_event_id,
  };
}

/**
 * Form D async poll via public ActionDispatcher.pollAsyncOperation.
 */
export async function pollAsyncOperationWithClient(
  client: AgentClient,
  accepted: PageManifest,
  options: InvokeOptions = {},
): Promise<PageManifest> {
  const dispatcher = client.actions as unknown as {
    pollAsyncOperation: (m: PageManifest, o: InvokeOptions) => Promise<PageManifest>;
  };
  return dispatcher.pollAsyncOperation(accepted, options);
}

export async function watchLoop(
  http: AppHttpClient,
  url: string,
  opts: {
    etag?: string | null;
    intervalMs?: number;
    refreshHintMs?: number;
    maxEvents?: number;
    timeoutMs?: number;
    onEvent?: (once: WatchOnceResult) => void | Promise<void>;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<WatchOnceResult[]> {
  const max = opts.maxEvents ?? 1;
  const timeout = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeout;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const out: WatchOnceResult[] = [];
  let etag = opts.etag ?? null;
  while (out.length < max && Date.now() < deadline) {
    const once = await watchOnce(http, url, {
      etag,
      intervalMs: opts.intervalMs,
      refreshHintMs: opts.refreshHintMs,
    });
    if (once.changed) {
      out.push(once);
      if (opts.onEvent) await opts.onEvent(once);
      etag = once.etag;
      if (out.length >= max) break;
    } else if (max === 1) {
      out.push(once);
      break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(once.interval_ms, remaining));
  }
  return out;
}
