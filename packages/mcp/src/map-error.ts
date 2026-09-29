/**
 * Envelope -> CallToolResult mapping (§10.4).
 * isError is true ONLY for status === "error". Holds use isError: false.
 */

import type { ToolEnvelope } from './runtime.js';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface CallToolResult {
  content: TextContent[];
  structuredContent: ToolEnvelope;
  isError: boolean;
}

export function envelopeToCallToolResult(envelope: ToolEnvelope): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    isError: envelope.status === 'error',
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  opts: {
    session?: string | null;
    retryable?: boolean;
    http_status?: number | null;
    details?: Record<string, unknown>;
  } = {},
): ToolEnvelope {
  return {
    app: '1.0',
    tool: '1.0',
    ok: false,
    status: 'error',
    session: opts.session ?? null,
    error: {
      code,
      message: message.slice(0, 500),
      retryable: opts.retryable ?? false,
      http_status: opts.http_status ?? null,
      details: opts.details,
    },
  };
}
