/**
 * Build/validate ToolEnvelope (CLIENT-TOOL-CONTRACT §4).
 */

import { getErrorMeta } from '@agent-page/client';
import {
  FALSE_OK_STATUSES,
  OK_STATUSES,
  TOOL_STATUSES,
  type ToolEnvelope,
  type ToolError,
  type ToolMeta,
  type ToolStatus,
} from './types.js';

const STATUS_SET = new Set<string>(TOOL_STATUSES);
const OK_SET = new Set<ToolStatus>(OK_STATUSES);
const FALSE_OK_SET = new Set<ToolStatus>(FALSE_OK_STATUSES);

export function isOkStatus(status: ToolStatus): boolean {
  return OK_SET.has(status);
}

export function isToolStatus(value: unknown): value is ToolStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

export class EnvelopeError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join('; '));
    this.name = 'EnvelopeError';
    this.issues = issues;
  }
}

export function buildEnvelope(
  status: ToolStatus,
  partial: Omit<Partial<ToolEnvelope>, 'app' | 'tool' | 'ok' | 'status'> = {},
): ToolEnvelope {
  if (!isToolStatus(status)) {
    throw new EnvelopeError([`unknown status: ${String(status)}`]);
  }
  const ok = isOkStatus(status);
  const env: ToolEnvelope = {
    app: '1.0',
    tool: '1.0',
    ok,
    status,
    ...partial,
  };
  if (status === 'hold') {
    delete env.error;
  }
  if (status === 'error') {
    delete env.hold;
  }
  validateEnvelope(env);
  return env;
}

export function errorEnvelope(
  code: string,
  message: string,
  opts: {
    session?: string | null;
    retryable?: boolean;
    http_status?: number | null;
    details?: Record<string, unknown>;
    request_id?: string;
    path?: string;
    recoverable_actions?: string[];
    retry_after_ms?: number | null;
    meta?: ToolMeta;
  } = {},
): ToolEnvelope {
  const meta = getErrorMeta(code);
  const error: ToolError = {
    code,
    message: message.slice(0, 500),
    retryable: opts.retryable ?? meta.retryable,
    http_status: opts.http_status !== undefined ? opts.http_status : meta.httpStatus,
  };
  if (opts.path) error.path = opts.path;
  if (opts.details) error.details = opts.details;
  if (opts.request_id) error.request_id = opts.request_id;
  if (opts.recoverable_actions) error.recoverable_actions = opts.recoverable_actions;
  if (opts.retry_after_ms !== undefined) error.retry_after_ms = opts.retry_after_ms;
  return buildEnvelope('error', {
    session: opts.session ?? null,
    error,
    meta: opts.meta ?? { warnings: [] },
  });
}

export function validateEnvelope(env: unknown): asserts env is ToolEnvelope {
  const issues: string[] = [];
  if (!env || typeof env !== 'object') {
    throw new EnvelopeError(['envelope is not an object']);
  }
  const e = env as ToolEnvelope;
  if (e.app !== '1.0') issues.push('app must be "1.0"');
  if (e.tool !== '1.0') issues.push('tool must be "1.0"');
  if (!isToolStatus(e.status)) issues.push(`unknown status: ${String(e.status)}`);
  if (typeof e.ok !== 'boolean') issues.push('ok must be boolean');

  if (isToolStatus(e.status)) {
    if (e.ok === true && !OK_SET.has(e.status)) {
      issues.push(`ok === true is invalid for status ${e.status}`);
    }
    if (e.ok === false && !FALSE_OK_SET.has(e.status)) {
      issues.push(`ok === false is invalid for status ${e.status}`);
    }
    if (e.status === 'hold') {
      if (!e.hold) issues.push('status hold MUST include hold');
      if (e.error) issues.push('status hold MUST NOT include error');
    }
    if (e.status === 'error') {
      if (!e.error) issues.push('status error MUST include error');
      else if (
        typeof e.error.code !== 'string' ||
        !/^app\.(err|warn)(\.[a-z0-9_]+)+$/.test(e.error.code)
      ) {
        issues.push('error.code must be an app.err.* / app.warn.* const');
      }
    }
  }

  if (issues.length) throw new EnvelopeError(issues);
}

/** Thrown from onConfirm after persisting a hold; never auto-approves. */
export class HoldSignal extends Error {
  readonly envelope: ToolEnvelope;

  constructor(envelope: ToolEnvelope) {
    super(envelope.hold?.body ?? envelope.hold?.title ?? 'hold');
    this.name = 'HoldSignal';
    this.envelope = envelope;
  }
}
