/** Core APP TypeScript types aligned with SPEC v0.4-Ultimate §§2–8 and v0.5-extreme 1.1. */

export type AppProtocolVersion = '1.0' | '1.1';

export type StateNodeType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'array'
  | 'object'
  | 'file'
  | 'table'
  | 'geopoint'
  | 'quantity'
  | 'order'
  | 'daterange'
  | 'datetimerange'
  | 'embed'
  | 'markdown'
  | 'media'
  | 'tree';

export type TableFieldType =
  'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'file' | 'null' | 'any';

export interface PaginationInfo {
  cursor: string | null;
  has_more: boolean;
  total: number | null;
}

export interface StateNodeBase {
  type: StateNodeType;
  label?: string;
}

export interface StringStateNode extends StateNodeBase {
  type: 'string';
  value: string;
  secret?: boolean;
}

export interface NumberStateNode extends StateNodeBase {
  type: 'number';
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  scale?: number;
}

export interface BooleanStateNode extends StateNodeBase {
  type: 'boolean';
  value: boolean;
}

export interface NullStateNode extends StateNodeBase {
  type: 'null';
}

export interface DateStateNode extends StateNodeBase {
  type: 'date';
  value: string;
}

export interface DateTimeStateNode extends StateNodeBase {
  type: 'datetime';
  value: string;
}

export interface EnumStateNode extends StateNodeBase {
  type: 'enum';
  value: string;
  options: string[];
  option_labels?: Record<string, string>;
}

export interface ArrayStateNode extends StateNodeBase {
  type: 'array';
  value: StateNode[];
  item_label?: string;
  pagination?: PaginationInfo;
}

export interface ObjectStateNode extends StateNodeBase {
  type: 'object';
  value: Record<string, StateNode>;
}

export interface FileValue {
  url: string;
  name: string;
  mime: string;
  size?: number;
  sha256?: string;
}

export interface FileStateNode extends StateNodeBase {
  type: 'file';
  value: FileValue;
}

export interface TableStateNode extends StateNodeBase {
  type: 'table';
  fields: Record<string, TableFieldType>;
  value: unknown[][];
  item_label?: string;
  pagination?: PaginationInfo;
}

export interface GeoPointValue {
  lat: number;
  lng: number;
  accuracy_m?: number;
  label?: string;
}

export interface GeoPointStateNode extends StateNodeBase {
  type: 'geopoint';
  value: GeoPointValue;
}

export interface QuantityValue {
  value: number;
  unit: string;
}

export interface QuantityStateNode extends StateNodeBase {
  type: 'quantity';
  value: QuantityValue;
  unit?: string;
}

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'awaiting_payment'
  | 'awaiting_3ds'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'delivered'
  | 'cancel_pending'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded'
  | 'failed';

export type PaymentStatus =
  'unpaid' | 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export interface OrderItem {
  sku: string;
  qty: number;
  amount: number;
}

export interface OrderPayment {
  status: PaymentStatus;
  psp?: string;
  start_url?: string;
}

export interface OrderValue {
  id: string;
  status: OrderStatus;
  currency?: string;
  total?: number;
  scale?: number;
  items?: OrderItem[];
  payment?: OrderPayment;
  created_at?: string;
  updated_at?: string;
  extra?: Record<string, string | number | boolean | null>;
}

export interface OrderStateNode extends StateNodeBase {
  type: 'order';
  value: OrderValue;
}

export interface DateRangeValue {
  from: string;
  to: string;
}

export interface DateRangeStateNode extends StateNodeBase {
  type: 'daterange';
  value: DateRangeValue;
}

export interface DateTimeRangeStateNode extends StateNodeBase {
  type: 'datetimerange';
  value: DateRangeValue;
}

export type EmbedSandboxFlag = 'scripts' | 'forms' | 'popups' | 'same-origin';

export interface EmbedStateNode extends StateNodeBase {
  type: 'embed';
  url: string;
  description: string;
  sandbox?: EmbedSandboxFlag[];
  height?: number;
}

export interface MarkdownStateNode extends StateNodeBase {
  type: 'markdown';
  value: string;
}

export interface MediaItem {
  url: string;
  alt?: string;
  kind?: 'image' | 'video' | 'audio';
}

export interface MediaStateNode extends StateNodeBase {
  type: 'media';
  value: MediaItem[];
}

export interface TreeItem {
  id: string;
  label: string;
  children?: TreeItem[];
}

export interface TreeStateNode extends StateNodeBase {
  type: 'tree';
  value: TreeItem[];
}

export type StateNode =
  | StringStateNode
  | NumberStateNode
  | BooleanStateNode
  | NullStateNode
  | DateStateNode
  | DateTimeStateNode
  | EnumStateNode
  | ArrayStateNode
  | ObjectStateNode
  | FileStateNode
  | TableStateNode
  | GeoPointStateNode
  | QuantityStateNode
  | OrderStateNode
  | DateRangeStateNode
  | DateTimeRangeStateNode
  | EmbedStateNode
  | MarkdownStateNode
  | MediaStateNode
  | TreeStateNode
  | (StateNodeBase & Record<string, unknown>);

/**
 * Well-known `state.capabilities` shape (C15): array of string StateNodes.
 * Example: `{ type: 'array', value: [{ type: 'string', value: 'diffs' }] }`
 */
export type CapabilitiesStateNode = ArrayStateNode;

export type ParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'array'
  | 'object'
  | 'geopoint'
  | 'file'
  | 'date_range'
  | 'datetime_range'
  | 'quantity'
  | 'money';

export interface ParamDef {
  type: ParamType;
  required?: boolean;
  description?: string;
  options?: string[];
  option_labels?: Record<string, string>;
  options_source?: {
    action: string;
    param: string;
    results_path: string;
    min_query_length?: number;
  };
  item_type?: ParamDef;
  properties?: Record<string, ParamDef>;
  default?: unknown;
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  min_items?: number;
  max_items?: number;
  pattern?: string;
  nullable?: boolean;
  example?: unknown;
  upload?: boolean;
  content_media_type?: string;
  /** 1.1 file transfer mode. */
  transfer?: 'multipart' | 'presign';
  accept_mime?: string[];
  max_bytes?: number;
  /** 1.1 quantity / money. */
  scale?: number;
  unit?: string;
  units?: string[];
  currency?: string;
}

export type ActionKind = 'query' | 'mutate' | 'navigate' | 'confirm' | 'delegate';
export type SideEffect = 'safe' | 'destructive' | 'financial' | 'identity';
export type AuthRequirement = 'none' | 'session' | 'bearer' | 'api_key' | string;
export type ParamMode = 'strict' | 'lenient';

export interface ActionOutput {
  state_diff?: boolean;
  changes?: string[];
  navigates_to?: string | null;
  delegates_to?: string | null;
  delegate_protocol?: 'app' | 'https' | null;
  /** Same-origin return URL after kind:delegate (K3 MF-9). */
  resume_url?: string | null;
}

/** ActionDef — first-class optional fields include param_mode / requires_etag_match (C16). */
export interface ActionDef {
  description: string;
  kind: ActionKind;
  input?: Record<string, ParamDef>;
  output?: ActionOutput;
  side_effect?: SideEffect;
  requires_confirmation?: boolean;
  auth?: AuthRequirement;
  idempotent?: boolean;
  timeout_ms?: number;
  rate_limit?: { limit: number; window_seconds: number };
  action_url?: string | null;
  /** Default `'strict'`. Read from ActionDef, not manifest.meta (C16). */
  param_mode?: ParamMode;
  /**
   * When true, client MUST send X-APP-If-Match-Version.
   * Name retained for compat; semantics = version match (C16).
   */
  requires_etag_match?: boolean;
  confirm?: {
    title?: string | null;
    body_template?: string | null;
    amount_path?: string;
  };
  policy?: ActionPolicyHints;
  async?: boolean;
  /** 1.1 bulk operations (§15). Emit only when selected version is 1.1. */
  bulk?: {
    max_items: number;
    mode: 'all_or_nothing' | 'best_effort';
  };
}

export interface PageInfo {
  id: string;
  url: string;
  title?: string;
  etag?: string;
  /** Sole concurrency token (C1). */
  version: string;
  generated_at?: string;
  language?: string;
  description?: string;
  /** 1.1 IANA zone for naive display. Emit only when selected 1.1. */
  time_zone?: string;
  /** 1.1 JSON Pointer deep focus. Emit only when selected 1.1. */
  focus?: string;
}

export interface SoftError {
  code: string;
  message: string;
  recoverable_actions?: string[];
  details?: Record<string, StateNode>;
}

export interface NavItem {
  label: string;
  url: string;
  page_id?: string;
  rel?: string;
}

export interface NavAnchor {
  id: string;
  label: string;
  pointer: string;
}

export interface Navigation {
  breadcrumb?: NavItem[];
  related?: NavItem[];
  /** 1.1 deep-focus anchors. Max 32. */
  anchors?: NavAnchor[];
}

export interface PageManifest {
  app: AppProtocolVersion;
  page: PageInfo;
  state: Record<string, StateNode>;
  actions?: Record<string, ActionDef>;
  navigation?: Navigation;
  present?: Record<string, unknown>;
  error?: SoftError;
  meta?: Record<string, unknown>;
}

export interface ActionRequestClient {
  kind?: 'agent' | 'renderer' | 'extension' | string;
  name?: string;
  version?: string;
}

export interface ActionRequestContext {
  page_id?: string;
  page_url?: string;
  manifest_version?: string;
}

export interface ActionRequest {
  app: AppProtocolVersion;
  action: string;
  params?: Record<string, unknown>;
  client?: ActionRequestClient;
  context?: ActionRequestContext;
}

export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

/** Diff Document — only base.version / result_version (C1/C2); no base.etag / result_etag. */
export interface DiffDocument {
  app: AppProtocolVersion;
  base: {
    page_id: string;
    page_url: string;
    version: string;
  };
  result_version: string;
  diff: JsonPatchOp[];
  navigation_effect?: { url: string; mode?: 'replace' | 'push'; reason?: string } | null;
  meta?: Record<string, unknown>;
}

export interface ErrorDetails {
  code: string;
  message: string;
  path?: string;
  retryable: boolean;
  http_status: number | null;
  details?: Record<string, StateNode>;
  recoverable_actions?: string[];
  request_id?: string;
  retry_after_ms?: number;
  /** 1.1 localization catalog id. Emit only when selected 1.1. */
  message_id?: string;
  /** 1.1 retry class. Emit only when selected 1.1. */
  retry_class?: RetryClass;
}

export interface ErrorEnvelope {
  app: AppProtocolVersion;
  error: ErrorDetails;
  /** Optional; used e.g. for confirmation challenge `meta.server_time` (§10.4). */
  meta?: Record<string, unknown>;
}

export type ActionResult =
  | { type: 'diff'; nextManifest: PageManifest }
  | { type: 'full'; manifest: PageManifest }
  | {
      type: 'navigate';
      url: string;
      mode?: 'replace' | 'push';
      /** Default 303. Use 201 when a resource was created. */
      status?: 303 | 201;
      /** Optional body for 201 Created only; 303 body MUST be empty. */
      manifest?: PageManifest;
    }
  | {
      type: 'async';
      jobId: string;
      pollIntervalMs: number;
      statusUrl?: string;
      status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
      progress?: number;
      /** Optional page fields override for the 202 accept manifest. */
      page?: PageManifest['page'];
      version?: string;
    };

export interface ActionContext {
  actionId: string;
  actionDef: ActionDef;
  params: Record<string, unknown>;
  request: ActionRequest;
  manifest: PageManifest;
  headers: Record<string, string | string[] | undefined>;
  sessionId?: string;
  requestId: string;
  /** Exact raw request body bytes (for confirmation / idempotency). */
  rawBody?: Buffer;
  /** Selected protocol version for this request (1.0 or 1.1). */
  selectedVersion?: AppProtocolVersion;
}

export type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>;
export type GetManifest = (req: {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}) => Promise<PageManifest | null>;

export interface ValidationFailure {
  code: string;
  message: string;
  path?: string;
  details?: Record<string, StateNode>;
}

export type RetryClass = 'none' | 'transport' | 'rate' | 'conflict' | 'auth' | 'hold' | 'challenge';

export interface ActionPolicyHints {
  secret_params?: string[];
  consent_purposes?: string[];
  step_up?: boolean;
  [key: string]: unknown;
}

export const FEATURE_FLAG_KEYS = [
  'identity_flows',
  'mfa',
  'passkey',
  'oauth',
  'magic_link',
  'human_hold',
  'consent',
  'events_sse',
  'events_longpoll',
  'events_ws',
  'session_resume',
  'typeahead',
  'file_presign',
  'geopoint',
  'quantity',
  'datetime_range',
  'bulk_actions',
  'commerce',
  'order_state',
  'deep_focus',
  'locale_tz',
  'error_i18n',
  'action_result_pagination',
  'drafts',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number] | `x_${string}`;

export type FeatureFlags = Record<string, boolean>;

export type FlowKind = 'password' | 'oauth' | 'passkey' | 'magic_link' | 'mixed';

export interface FlowCatalogEntry {
  kind: FlowKind;
  entry_url: string;
  logout_url?: string;
  signup_url?: string;
  recovery_url?: string;
  providers?: Array<{ id: string; start_url: string; label?: string }>;
  mfa?: boolean;
}

export type ChallengeKind =
  'otp' | 'totp' | 'sms' | 'email' | 'webauthn' | 'backup_code' | 'magic_link';

export type ChallengeChannel =
  'sms' | 'email' | 'totp' | 'authenticator_push' | 'passkey' | 'backup_code' | 'voice';

export interface ChallengeObject {
  id: string;
  kind: ChallengeKind;
  channel?: ChallengeChannel;
  param?: string;
  /** @deprecated v0.4 field name; v1.1 uses `length`. */
  min_length?: number;
  /** @deprecated v0.4 field name; v1.1 uses `length`. */
  max_length?: number;
  /** SHOULD — destination hint; MUST NOT be a full phone/email (§6.1). */
  mask?: string;
  /** SHOULD for otp/totp — code length 4..12 (§6.1). */
  length?: number;
  pattern?: string;
  ttl_ms?: number;
  expires_at?: string;
  attempts_remaining?: number;
  max_attempts?: number;
  resend_available_at?: string;
  /** Action id used to request a new challenge (§6.1). */
  resend_action?: string;
  poll_interval_ms?: number;
  public_key?: Record<string, unknown>;
}

export type HoldKind = 'captcha' | 'liveness' | 'webview';

export interface HoldObject {
  id: string;
  kind: HoldKind;
  status: 'pending' | 'cleared' | 'expired' | 'failed';
  who: 'human';
  verify_url: string;
  widget_url?: string;
  /** SHOULD — action id on the verify page (§7.1). */
  resume_action?: string;
  ttl_ms?: number;
  expires_at?: string;
  agent_solvable: false;
  issued_count?: number;
  /** Present on the complete_hold response document only. */
  token?: string;
}

export type ConsentPurposeId =
  | 'necessary'
  | 'functional'
  | 'analytics'
  | 'marketing'
  | 'personalization'
  | 'sharing_third_party'
  | `x-${string}`;

export interface ConsentGrant {
  id: string;
  granted: boolean;
}

export type SessionStatus = 'anonymous' | 'pending_mfa' | 'authenticated' | 'expired';

export interface SessionStateValue {
  status: SessionStatus;
  subject_ref?: string;
  has_access_token?: boolean;
  expires_at?: string;
}

export type EventType =
  | 'state.changed'
  | 'page.replaced'
  | 'action.completed'
  | 'session.expired'
  | 'hold.cleared'
  | 'challenge.updated'
  | 'order.updated'
  | 'consent.changed'
  | 'heartbeat';

export type EventHint = 'revalidate' | 'diff' | 'drop';

export interface EventRecordBody {
  id: string;
  type: EventType | string;
  page_id: string;
  page_url: string;
  version: string;
  occurred_at: string;
  base_version?: string;
  hint: EventHint;
  diff?: DiffDocument | null;
  pointers?: string[];
}

export interface EventRecord {
  app: AppProtocolVersion;
  event: EventRecordBody;
}

export type MoneyParamValue = {
  amount: number;
  scale: number;
  currency: string;
};

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['pending', 'cancelled', 'failed'],
  pending: ['awaiting_payment', 'cancelled', 'failed'],
  awaiting_payment: ['awaiting_3ds', 'paid', 'failed', 'cancelled'],
  awaiting_3ds: ['paid', 'failed', 'awaiting_payment'],
  paid: ['fulfilling', 'refund_pending', 'cancelled', 'failed'],
  fulfilling: ['shipped', 'refund_pending', 'cancelled', 'failed'],
  shipped: ['delivered', 'refund_pending', 'failed'],
  delivered: ['refund_pending'],
  cancel_pending: ['cancelled', 'awaiting_payment', 'fulfilling'],
  cancelled: [],
  refund_pending: ['refunded', 'paid', 'failed'],
  refunded: [],
  failed: [],
};

export const ORDER_TERMINAL: readonly OrderStatus[] = [
  'delivered',
  'cancelled',
  'refunded',
  'failed',
];
