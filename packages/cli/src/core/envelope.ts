import type { ToolEnvelope, ToolError, ToolMeta, ToolStatus } from './types.js';

const OK_STATUSES: ReadonlySet<ToolStatus> = new Set([
  'ok',
  'navigated',
  'not_modified',
  'async_pending',
  'async_succeeded',
  'closed',
]);

export function isOkStatus(status: ToolStatus): boolean {
  return OK_STATUSES.has(status);
}

export function buildEnvelope(
  status: ToolStatus,
  partial: Omit<Partial<ToolEnvelope>, 'app' | 'tool' | 'ok' | 'status'> & {
    error?: ToolError;
  } = {},
): ToolEnvelope {
  const ok = isOkStatus(status);
  const env: ToolEnvelope = {
    app: '1.0',
    tool: '1.0',
    ok,
    status,
    ...partial,
  };
  if (status === 'hold' && env.error) {
    delete env.error;
  }
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
    meta?: ToolMeta;
  } = {},
): ToolEnvelope {
  return buildEnvelope('error', {
    session: opts.session ?? null,
    error: {
      code,
      message,
      retryable: opts.retryable ?? false,
      http_status: opts.http_status ?? null,
      details: opts.details,
      request_id: opts.request_id,
    },
    meta: opts.meta ?? { warnings: [] },
  });
}

export class HoldSignal extends Error {
  readonly envelope: ToolEnvelope;

  constructor(envelope: ToolEnvelope) {
    super(envelope.hold?.body ?? envelope.hold?.title ?? 'hold');
    this.name = 'HoldSignal';
    this.envelope = envelope;
  }
}
