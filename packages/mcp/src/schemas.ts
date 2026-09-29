/**
 * MCP tool input schemas from CLIENT-TOOL-CONTRACT §10 (as objects, not strings).
 */

export type JsonSchema = Record<string, unknown>;

export const TOOL_ENVELOPE_OUTPUT_SCHEMA: JsonSchema = {
  $id: 'tool/envelope.json',
  type: 'object',
  required: ['app', 'tool', 'ok', 'status'],
  additionalProperties: true,
  properties: {
    app: { const: '1.0' },
    tool: { const: '1.0' },
    ok: { type: 'boolean' },
    status: {
      type: 'string',
      enum: [
        'ok',
        'hold',
        'error',
        'async_pending',
        'async_succeeded',
        'async_failed',
        'navigated',
        'not_modified',
        'closed',
      ],
    },
  },
};

export const APP_DISCOVER_IN: JsonSchema = {
  $id: 'tool/mcp/app_discover.in.json',
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: {
      type: 'string',
      minLength: 1,
      maxLength: 2048,
      description: 'Origin or any URL on the origin',
    },
    session: { type: 'string' },
  },
};

export const APP_OPEN_IN: JsonSchema = {
  $id: 'tool/mcp/app_open.in.json',
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    session: { type: 'string' },
    discover: { type: 'boolean', default: true },
    force: { type: 'boolean', default: false },
    title: { type: 'string', maxLength: 200 },
    full: { type: 'boolean', default: false },
    top_k: { type: 'integer', minimum: 0, default: 8 },
  },
};

export const APP_READ_IN: JsonSchema = {
  $id: 'tool/mcp/app_read.in.json',
  type: 'object',
  additionalProperties: false,
  properties: {
    session: { type: 'string' },
    path: {
      type: 'string',
      description: 'JSON Pointer into the current manifest, e.g. /state/results',
    },
    actions_only: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    top_k: { type: 'integer', minimum: 0, default: 8 },
  },
};

export const APP_ACT_IN: JsonSchema = {
  $id: 'tool/mcp/app_act.in.json',
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: {
    action: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
    params: {
      type: 'object',
      maxProperties: 64,
      propertyNames: { pattern: '^[a-z][a-z0-9_]{0,63}$' },
      additionalProperties: true,
      description: 'Plain JSON params (NOT StateNodes). TV-22.',
    },
    files: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        required: ['param', 'path'],
        additionalProperties: false,
        properties: {
          param: { type: 'string' },
          path: {
            type: 'string',
            description: 'Absolute filesystem path readable by the MCP process',
          },
        },
      },
    },
    session: { type: 'string' },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
    confirmation: { type: 'string', maxLength: 512 },
    wait: { type: 'boolean', default: true },
    follow: { type: 'boolean', default: true },
    conflict_retry: { type: 'boolean', default: true },
    full: { type: 'boolean', default: false },
    top_k: { type: 'integer', minimum: 0, default: 8 },
  },
};

export const APP_CONFIRM_IN: JsonSchema = {
  $id: 'tool/mcp/app_confirm.in.json',
  type: 'object',
  required: ['decision'],
  additionalProperties: false,
  properties: {
    decision: { enum: ['approve', 'reject'] },
    session: { type: 'string' },
    token: {
      type: 'string',
      maxLength: 512,
      description: 'Must equal stored challenge if provided',
    },
    wait: { type: 'boolean', default: true },
    full: { type: 'boolean', default: false },
  },
};

export const APP_CHALLENGE_IN: JsonSchema = {
  $id: 'tool/mcp/app_challenge.in.json',
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: { enum: ['mfa', 'otp', 'abort'] },
    value: {
      type: 'string',
      minLength: 1,
      maxLength: 4096,
      description: 'OTP/backup code; required for otp/totp/backup_code; never logged',
    },
    session: { type: 'string' },
  },
};

export const APP_WATCH_IN: JsonSchema = {
  $id: 'tool/mcp/app_watch.in.json',
  type: 'object',
  additionalProperties: false,
  properties: {
    session: { type: 'string' },
    mode: { enum: ['poll', 'subscribe'], default: 'poll' },
    interval_ms: { type: 'integer', minimum: 1000, maximum: 120000 },
    sse: { type: 'boolean', default: false },
    ws: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
  },
};

export const APP_SESSIONS_IN: JsonSchema = {
  $id: 'tool/mcp/app_sessions.in.json',
  type: 'object',
  required: ['op'],
  additionalProperties: false,
  properties: {
    op: { enum: ['list', 'show', 'switch', 'close', 'gc'] },
    session: { type: 'string' },
  },
};

export const APP_LOGOUT_IN: JsonSchema = {
  $id: 'tool/mcp/app_logout.in.json',
  type: 'object',
  additionalProperties: false,
  properties: {
    origin: { type: 'string' },
    all: { type: 'boolean', default: false },
    session: { type: 'string' },
  },
};

export const APP_RESET_IN: JsonSchema = {
  $id: 'tool/mcp/app_reset.in.json',
  type: 'object',
  additionalProperties: false,
  properties: {
    all: { type: 'boolean', default: false },
    session: { type: 'string' },
  },
};

/** Fixed tool names in normative order (§10.3). */
export const FIXED_TOOL_NAMES = [
  'app_discover',
  'app_open',
  'app_read',
  'app_act',
  'app_confirm',
  'app_challenge',
  'app_watch',
  'app_sessions',
  'app_logout',
  'app_reset',
] as const;

export type FixedToolName = (typeof FIXED_TOOL_NAMES)[number];

export const INPUT_SCHEMAS: Record<FixedToolName, JsonSchema> = {
  app_discover: APP_DISCOVER_IN,
  app_open: APP_OPEN_IN,
  app_read: APP_READ_IN,
  app_act: APP_ACT_IN,
  app_confirm: APP_CONFIRM_IN,
  app_challenge: APP_CHALLENGE_IN,
  app_watch: APP_WATCH_IN,
  app_sessions: APP_SESSIONS_IN,
  app_logout: APP_LOGOUT_IN,
  app_reset: APP_RESET_IN,
};

export const TOOL_DESCRIPTIONS: Record<FixedToolName, string> = {
  app_discover: 'Discover APP well-known metadata for an origin',
  app_open: 'Hydrate a URL into an APP session and return a page digest',
  app_read: 'Read digest, a JSON Pointer path, or actions-only from the current session',
  app_act: 'Invoke a page action by id with plain JSON params',
  app_confirm: 'Approve or reject a confirmation hold (Mode A)',
  app_challenge: 'Complete MFA/OTP challenge hold; not CAPTCHA or consent',
  app_watch: 'Poll once or subscribe for page/event changes',
  app_sessions: 'list/show/switch/close/gc APP sessions',
  app_logout: 'Drop credentials and private cache for a session or origin',
  app_reset: 'Reset a session or the entire AGENT_PAGE_HOME',
};
