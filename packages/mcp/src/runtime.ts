/**
 * Contract-facing ToolRuntime surface (CLIENT-TOOL-CONTRACT §11.2).
 * Matches @agent-page/tool-core / cli src/core createRuntime() return shape.
 */

export type ToolStatus =
  | 'ok'
  | 'hold'
  | 'error'
  | 'async_pending'
  | 'async_succeeded'
  | 'async_failed'
  | 'navigated'
  | 'not_modified'
  | 'closed';

export interface ToolEnvelope {
  app: '1.0';
  tool: '1.0';
  ok: boolean;
  status: ToolStatus;
  session?: string | null;
  request_id?: string | null;
  page?: Record<string, unknown>;
  digest?: {
    page?: { id?: string; url?: string; version?: string; [k: string]: unknown };
    state?: Record<string, unknown>;
    actions?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };
  act?: Record<string, unknown>;
  hold?: Record<string, unknown> | null;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    http_status?: number | null;
    path?: string;
    details?: Record<string, unknown>;
    recoverable_actions?: string[];
    request_id?: string;
    retry_after_ms?: number | null;
  };
  discovery?: Record<string, unknown>;
  sessions?: Array<Record<string, unknown>>;
  watch?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface SessionLike {
  id: string;
  origin: string;
  title?: string | null;
  current?: {
    page_id: string;
    url: string;
    version: string;
    etag?: string | null;
    title?: string | null;
  } | null;
  current_page_id?: string | null;
  current_url?: string | null;
  current_version?: string | null;
  hold_kind?: string | null;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
}

export interface HoldStoreLike {
  load(sessionId: string): Record<string, unknown> | null;
}

export interface SessionStoreLike {
  listSessions(): SessionLike[];
  readSession(id: string): SessionLike;
  readPublicCache?(url: string): { manifest?: Record<string, unknown> } | null;
  currentSessionId?(explicit?: string | null): string | null;
}

export interface CreateRuntimeOptions {
  home?: string;
  fetch?: typeof globalThis.fetch;
  dynamicTools?: boolean;
  clientName?: string;
  clientVersion?: string;
  bearerEnv?: string;
  apiKeyEnv?: string;
  cookieJar?: string;
  topK?: number;
  session?: string;
}

export type ToolArgs = Record<string, unknown>;

/**
 * Core ToolRuntime from tool-core. Every method takes the validated MCP tool
 * arguments object unchanged — the runtime reads the same field names the
 * input schemas declare (url, session, action, params, decision, kind, ...).
 */
export interface ToolRuntime {
  client?: unknown;
  store: SessionStoreLike;
  credentials?: unknown;
  holds: HoldStoreLike;
  opts?: Record<string, unknown>;

  digest?: (...args: unknown[]) => unknown;
  open: (args: ToolArgs) => Promise<ToolEnvelope>;
  read: (args: ToolArgs) => Promise<ToolEnvelope>;
  act: (args: ToolArgs) => Promise<ToolEnvelope>;
  confirm: (args: ToolArgs) => Promise<ToolEnvelope>;
  challenge: (args: ToolArgs) => Promise<ToolEnvelope>;
  watch: (args: ToolArgs) => Promise<ToolEnvelope>;
  sessions: (args: ToolArgs) => Promise<ToolEnvelope>;
  logout: (args: ToolArgs) => Promise<ToolEnvelope>;
  reset: (args: ToolArgs) => Promise<ToolEnvelope>;
  discover: (args: ToolArgs) => Promise<ToolEnvelope>;
  getCurrentSessionId: () => string | null;
}

export type CreateRuntime = (opts?: CreateRuntimeOptions) => ToolRuntime;
