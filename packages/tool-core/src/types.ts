/**
 * ToolEnvelope, Hold, SessionFile types (CLIENT-TOOL-CONTRACT §4, §9).
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

export type HoldKind =
  | 'confirmation'
  | 'mfa'
  | 'otp'
  | 'human_verification'
  | 'consent'
  | 'delegate'
  | 'auth'
  | 'unknown';

/** D-10 pipeline gate kinds. Ordered earliest first: challenge -> hold -> consent -> confirmation. */
export type GateKind = 'challenge' | 'hold' | 'consent' | 'confirmation' | 'delegate' | 'auth';

export type ToolHoldLevel = 'L1' | 'L2' | 'L3' | 'L4';
export type ToolSideEffect = 'safe' | 'destructive' | 'financial' | 'identity';

export interface PageRef {
  id: string;
  url: string;
  version: string;
  title?: string;
  etag?: string;
  description?: string;
}

export interface ActionSummary {
  id: string;
  description: string;
  kind: string;
  side_effect: string;
  requires_confirmation: boolean;
  idempotent: boolean;
  auth: string;
  param_mode?: string;
  requires_etag_match?: boolean;
  timeout_ms?: number;
  async?: boolean;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  policy?: {
    pii_params?: string[];
    scopes?: string[];
    max_financial?: unknown;
    key_header?: string;
  };
}

export interface PageDigest {
  page: PageRef;
  state: Record<string, unknown>;
  actions: ActionSummary[];
  navigation?: unknown | null;
  soft_error?: unknown | null;
  capabilities?: string[];
  features?: Record<string, boolean>;
  truncated?: boolean;
  top_k?: number;
}

export interface ActResult {
  action: string;
  mode: 'diff' | 'full' | 'redirect' | 'async' | '304';
  base_version?: string | null;
  result_version: string;
  diff?: unknown[];
  state_delta?: Record<string, unknown>;
  actions_delta?: {
    added: string[];
    removed: string[];
    replaced: string[];
  };
  navigation_effect?: unknown | null;
  idempotency_key?: string | null;
}

export interface Hold {
  kind: HoldKind;
  preflight?: boolean;
  action: string;
  page_url: string;
  page_version?: string;
  level?: ToolHoldLevel;
  side_effect?: ToolSideEffect | string;
  title?: string | null;
  body?: string | null;
  amount?: {
    value: number;
    unit?: string;
    scale?: number;
    path?: string;
  } | null;
  challenge?: string | null;
  expires_at?: string | null;
  pii_params?: string[];
  delegate?: {
    /** Off-origin hand-off target (`delegates_to`); human completes there. */
    url?: string;
    protocol?: 'app' | 'https';
    reason?: string;
    /** Declared same-origin return URL (K3 MF-9) — preferred over guessing page.url. */
    resume_url?: string | null;
  } | null;
  origin?: string;
  resume_hint?: string | null;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  path?: string;
  http_status?: number | null;
  details?: Record<string, unknown>;
  recoverable_actions?: string[];
  request_id?: string;
  retry_after_ms?: number | null;
}

export interface Discovery {
  origin: string;
  well_known_url: string;
  supported: boolean;
  site_name?: string | null;
  protocol_version?: string | null;
  capabilities?: string[];
  entry_urls?: Record<string, string>;
}

export interface SessionSummary {
  id: string;
  origin: string;
  title?: string | null;
  current_page_id?: string | null;
  current_url?: string | null;
  current_version?: string | null;
  hold_kind?: string | null;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
}

export interface WatchResult {
  transport: 'poll' | 'sse' | 'longpoll' | 'ws';
  changed: boolean;
  subscription_id?: string | null;
  interval_ms?: number;
  last_event_id?: string | null;
}

export interface ToolMeta {
  warnings?: string[];
  duration_ms?: number;
  cache?: 'hit' | 'revalidated' | 'miss' | 'bypass';
  negotiated_version?: string;
  truncated?: boolean;
}

export interface ToolEnvelope {
  app: '1.0';
  tool: '1.0';
  ok: boolean;
  status: ToolStatus;
  session?: string | null;
  request_id?: string | null;
  page?: PageRef;
  digest?: PageDigest;
  act?: ActResult;
  hold?: Hold | null;
  error?: ToolError;
  discovery?: Discovery;
  sessions?: SessionSummary[];
  watch?: WatchResult;
  meta?: ToolMeta;
}

export interface HoldGate {
  kind: GateKind;
  status: 'pending' | 'cleared';
  at: string;
  challenge?: string | null;
  hold_token?: string | null;
  grant?: string[] | null;
}

export interface HoldFile {
  schema: 'agent-page.hold/1.0';
  kind: Exclude<HoldKind, 'unknown'>;
  action: string;
  page_url: string;
  page_version: string;
  post_url: string;
  challenge: string | null;
  idempotency_key: string | null;
  if_match_version: string | null;
  raw_body_b64: string;
  body_sha256: string;
  level?: ToolHoldLevel;
  side_effect?: string;
  amount?: Hold['amount'];
  created_at: string;
  expires_at: string;
  gates: HoldGate[];
  title?: string | null;
  body?: string | null;
  origin?: string;
  pii_params?: string[];
  preflight?: boolean;
  verify_url?: string;
  widget_url?: string;
  challenge_param?: string;
  attempts_remaining?: number;
  ttl_ms?: number;
  hold_token?: string | null;
  challenge_kind?: string;
  delegate?: Hold['delegate'];
}

export interface SessionFile {
  schema: 'agent-page.session/1.0';
  id: string;
  created_at: string;
  updated_at: string;
  last_used_at: string;
  origin: string;
  title?: string | null;
  protocol_version: string;
  accepted_versions: string[];
  capabilities: string[];
  auth: {
    mode: 'none' | 'session' | 'bearer' | 'api_key';
    env_ref?: string | null;
    cookie_jar?: string | null;
  };
  resume?: {
    present: boolean;
    expires_at?: string | null;
    header?: 'X-APP-Resume';
  };
  current: {
    page_id: string;
    url: string;
    version: string;
    etag?: string | null;
    title?: string | null;
  } | null;
  stack: string[];
  last_action?: {
    id: string;
    at: string;
    idempotency_key?: string | null;
    result_version?: string | null;
    mode?: string | null;
  } | null;
  watch?: {
    last_event_id?: string | null;
    subscribed?: boolean;
  };
  cache_policy: 'public_only';
  flags?: {
    v05_features?: boolean;
    strict?: boolean;
  };
}

export interface IndexFile {
  schema: 'agent-page.index/1.0';
  current: string | null;
  sessions: string[];
  home_version: '1.0';
}

export interface ToolConfig {
  output?: 'json' | 'pretty';
  top_k?: number;
  timeout_ms?: number;
  session_ttl_ms?: number;
  async_wait?: boolean;
  policy_strict?: boolean;
  strict?: boolean;
  dynamic_tools?: boolean;
  listen?: string | null;
}

export interface CacheFile {
  schema: 'agent-page.cache/1.0';
  url: string;
  etag?: string | null;
  version: string;
  fetched_at: number;
  ttl_ms: number;
  private: false;
  cache_control?: string | null;
  manifest: unknown;
}

export const GATE_PIPELINE_ORDER: readonly GateKind[] = [
  'challenge',
  'hold',
  'consent',
  'confirmation',
] as const;

export const TOOL_STATUSES: readonly ToolStatus[] = [
  'ok',
  'hold',
  'error',
  'async_pending',
  'async_succeeded',
  'async_failed',
  'navigated',
  'not_modified',
  'closed',
] as const;

export const OK_STATUSES: readonly ToolStatus[] = [
  'ok',
  'navigated',
  'not_modified',
  'async_pending',
  'async_succeeded',
  'closed',
] as const;

export const FALSE_OK_STATUSES: readonly ToolStatus[] = ['hold', 'error', 'async_failed'] as const;

export const DEFAULT_TOP_K = 8;
export const DEFAULT_SESSION_TTL_MS = 86_400_000;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const CONFIRMATION_TTL_MS = 300_000;
export const EXPIRY_SKEW_MS = 60_000;
export const HUMAN_HOLD_BUDGET = 3;
export const LOCK_STALE_MS = 30_000;
export const LOCK_WAIT_MS = 5_000;
export const WATCH_INTERVAL_FLOOR_MS = 1000;
export const WATCH_INTERVAL_DEFAULT_MS = 5000;
export const TOOL_VERSION = '0.5.0';
export const TOOL_ENVELOPE_VERSION = '1.0';

export const HEADER_APP_CHALLENGE = 'X-APP-Challenge';
export const HEADER_APP_HOLD_TOKEN = 'X-APP-Hold-Token';
export const HEADER_APP_RESUME = 'X-APP-Resume';
export const HEADER_SET_APP_RESUME = 'Set-APP-Resume';
export const MEDIA_EVENT = 'application/vnd.agent-page-event+json';
export const MEDIA_EVENT_STREAM = 'text/event-stream';
