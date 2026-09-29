/**
 * Async action lifecycle — Form D (SPEC §3.4.3 / §6.9 / C5).
 * 202 Accepted + Page Manifest with operation_status + meta.poll_interval_ms.
 */

import { APP_VERSION } from './media-types.js';
import type {
  ActionDef,
  AppProtocolVersion,
  ErrorEnvelope,
  PageManifest,
  StateNode,
} from './types.js';
import { buildErrorEnvelope } from './errors.js';
import { bumpVersion } from './version.js';

export type AsyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const ASYNC_STATUS_OPTIONS: AsyncJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

export interface AsyncJob {
  id: string;
  actionId: string;
  pageId: string;
  status: AsyncJobStatus;
  pollIntervalMs: number;
  statusUrl: string;
  progress?: number;
  createdAt: number;
  updatedAt: number;
  resultManifest?: PageManifest;
  error?: ErrorEnvelope;
}

export interface AsyncJobStore {
  get(jobId: string): Promise<AsyncJob | null>;
  set(job: AsyncJob): Promise<void>;
}

export class MemoryAsyncJobStore implements AsyncJobStore {
  private readonly map = new Map<string, AsyncJob>();

  async get(jobId: string): Promise<AsyncJob | null> {
    return this.map.get(jobId) ?? null;
  }

  async set(job: AsyncJob): Promise<void> {
    this.map.set(job.id, job);
  }

  clear(): void {
    this.map.clear();
  }
}

export const DEFAULT_POLL_INTERVAL_MS = 2000;

export function buildOperationStatusNode(opts: {
  state: AsyncJobStatus;
  statusUrl: string;
  progress?: number;
}): StateNode {
  const value: Record<string, StateNode> = {
    state: {
      type: 'enum',
      value: opts.state,
      options: [...ASYNC_STATUS_OPTIONS],
    },
    status_url: {
      type: 'string',
      value: opts.statusUrl,
    },
  };
  if (opts.progress !== undefined) {
    value.progress = {
      type: 'number',
      value: opts.progress,
      min: 0,
      max: 1,
      label: 'Progress (0-1)',
    };
  }
  return {
    type: 'object',
    label: 'Operation status',
    value,
  };
}

/**
 * Form D accept / status Page Manifest with obligatory `operation_status`.
 */
export function buildAsyncPendingManifest(opts: {
  page: PageManifest['page'];
  jobId: string;
  statusUrl: string;
  status?: AsyncJobStatus;
  progress?: number;
  pollIntervalMs?: number;
  requestId?: string;
  actions?: Record<string, ActionDef>;
  /** Negotiated protocol version stamped on the manifest. Default '1.0'. */
  app?: AppProtocolVersion;
  /** Soft error only for status docs (failed / still-pending polls) — never on 202 accept. */
  softError?: { code: string; message: string };
  bumpPageVersion?: boolean;
}): PageManifest {
  const poll = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const status = opts.status ?? 'queued';
  const page = opts.bumpPageVersion
    ? { ...opts.page, version: bumpVersion(opts.page.version) }
    : { ...opts.page };

  const actions: Record<string, ActionDef> = {
    ...(opts.actions ?? {}),
  };

  // Cancellation support pattern (§6.9#6)
  if (!actions.cancel_operation && (status === 'queued' || status === 'running')) {
    actions.cancel_operation = {
      description: 'Cancel the in-flight async operation',
      kind: 'mutate',
      input: {},
      output: { state_diff: true },
      side_effect: 'safe',
      idempotent: true,
      timeout_ms: 10000,
      auth: 'none',
    };
  }

  const manifest: PageManifest = {
    app: opts.app ?? APP_VERSION,
    page,
    state: {
      operation_status: buildOperationStatusNode({
        state: status,
        statusUrl: opts.statusUrl,
        progress: opts.progress,
      }),
    },
    actions,
    meta: {
      poll_interval_ms: poll,
      ...(opts.requestId ? { request_id: opts.requestId } : {}),
    },
  };

  if (opts.softError) {
    manifest.error = {
      code: opts.softError.code,
      message: opts.softError.message,
      details: {
        job_id: { type: 'string', value: opts.jobId },
      },
    };
  }

  return manifest;
}

/**
 * Soft-only helper for status documents that are still in progress.
 * NEVER use as the hard failure of a 202 accept (C5 / §6.9#5).
 * @deprecated Prefer buildAsyncPendingManifest with softError for status polls.
 */
export function buildAsyncPendingEnvelope(opts: {
  jobId: string;
  pollIntervalMs?: number;
  message?: string;
  requestId?: string;
  status?: string;
}): ErrorEnvelope {
  const poll = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const details: Record<string, StateNode> = {
    job_id: { type: 'string', value: opts.jobId, label: 'Job ID' },
    status: {
      type: 'string',
      value: opts.status ?? 'running',
      label: 'Status',
    },
  };
  return buildErrorEnvelope('app.err.action.async_pending', {
    message: opts.message ?? 'Async action is still in progress',
    httpStatus: 200,
    retryable: true,
    retry_after_ms: poll,
    request_id: opts.requestId,
    details,
  });
}

/** Soft error for terminal failed status docs. */
export function buildAsyncFailedSoftError(opts: {
  jobId: string;
  message?: string;
  recoverable_actions?: string[];
}): NonNullable<PageManifest['error']> {
  return {
    code: 'app.err.action.async_failed',
    message: opts.message ?? 'Async action failed',
    recoverable_actions: opts.recoverable_actions,
    details: {
      job_id: { type: 'string', value: opts.jobId },
    },
  };
}

export async function createAsyncJob(
  store: AsyncJobStore,
  opts: {
    id: string;
    actionId: string;
    pageId: string;
    statusUrl: string;
    pollIntervalMs?: number;
    status?: AsyncJobStatus;
    progress?: number;
  },
): Promise<AsyncJob> {
  const now = Date.now();
  const job: AsyncJob = {
    id: opts.id,
    actionId: opts.actionId,
    pageId: opts.pageId,
    status: opts.status ?? 'queued',
    pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    statusUrl: opts.statusUrl,
    progress: opts.progress,
    createdAt: now,
    updatedAt: now,
  };
  await store.set(job);
  return job;
}

/** Update job status (e.g. cancel_operation handler). */
export async function updateAsyncJobStatus(
  store: AsyncJobStore,
  jobId: string,
  status: AsyncJobStatus,
  progress?: number,
): Promise<AsyncJob | null> {
  const job = await store.get(jobId);
  if (!job) return null;
  job.status = status;
  if (progress !== undefined) job.progress = progress;
  job.updatedAt = Date.now();
  await store.set(job);
  return job;
}

/**
 * Build a cancel_operation ActionHandler pattern for status pages.
 */
export function createCancelOperationHandler(
  store: AsyncJobStore,
  jobId: string,
): (ctx: { manifest: PageManifest }) => Promise<{ type: 'full'; manifest: PageManifest }> {
  return async ({ manifest }) => {
    const job = await updateAsyncJobStatus(store, jobId, 'cancelled');
    const next = buildAsyncPendingManifest({
      page: { ...manifest.page, version: bumpVersion(manifest.page.version) },
      jobId,
      statusUrl: job?.statusUrl ?? '',
      status: 'cancelled',
      pollIntervalMs: job?.pollIntervalMs,
      actions: {},
    });
    // Remove cancel once terminal
    delete next.actions?.cancel_operation;
    return { type: 'full', manifest: next };
  };
}
