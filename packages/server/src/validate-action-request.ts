/**
 * Action request body + header validation (SPEC §3.1, §6, §6.6).
 * Wrong Content-Type → 415 unsupported_media_type.
 * param_mode / requires_etag_match come from ActionDef (C16), not meta.
 */

import { parseMediaType, MEDIA_ACTION } from './media-types.js';
import type {
  ActionDef,
  ActionRequest,
  AppProtocolVersion,
  ParamType,
  SideEffect,
  ValidationFailure,
} from './types.js';
import { validateParams, type ParamMode } from './validate-params.js';

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SENSITIVE_SIDE_EFFECTS: SideEffect[] = ['financial', 'destructive', 'identity'];
const CLIENT_KINDS = new Set(['agent', 'renderer', 'extension', 'test']);
const ACTION_REQUEST_ROOT_KEYS = new Set(['app', 'action', 'params', 'client', 'context']);

export interface ActionRequestValidationResult {
  ok: true;
  request: ActionRequest;
  params: Record<string, unknown>;
  actionDef: ActionDef;
  actionId: string;
}

export interface ActionRequestValidationError {
  ok: false;
  error: ValidationFailure;
}

const V11_PARAM_TYPES = new Set<ParamType>([
  'geopoint',
  'file',
  'date_range',
  'datetime_range',
  'quantity',
  'money',
]);
export const CHALLENGE_CONTINUATION_PARAMS = ['otp', 'credential'];

export interface ValidateActionRequestOptions {
  contentType?: string | null;
  idempotencyKey?: string | null;
  /** Override; defaults to actionDef.param_mode ?? 'strict'. */
  paramMode?: ParamMode;
  body: unknown;
  actions: Record<string, ActionDef> | undefined;
  /**
   * When false, skip parameter validation (middleware runs params at step 10).
   * Default true for standalone use.
   */
  validateParameters?: boolean;
  /** Selected protocol version for this request (1.0 or 1.1). */
  selectedVersion?: AppProtocolVersion;
  /** Advertised challenge param names to allow on 1.1 continuation. */
  challengeParams?: string[];
  /** True when this POST continues an inline 428 challenge. */
  challengeContinuation?: boolean;
}

export function requiresIdempotencyKey(actionDef: ActionDef): boolean {
  const side = actionDef.side_effect ?? 'safe';
  if (SENSITIVE_SIDE_EFFECTS.includes(side)) return true;
  if (actionDef.idempotent === false) return true;
  return false;
}

export function requiresConfirmation(actionDef: ActionDef): boolean {
  if (actionDef.requires_confirmation) return true;
  const side = actionDef.side_effect ?? 'safe';
  return SENSITIVE_SIDE_EFFECTS.includes(side);
}

/**
 * Parse + structural validate an Action Request without requiring full param validation.
 * Used by middleware to check action existence before confirmation/idempotency/params (§6.6).
 */
export function parseActionRequestBody(body: unknown):
  | {
      ok: true;
      raw: Record<string, unknown>;
      actionId: string;
      requestStub: Partial<ActionRequest>;
    }
  | { ok: false; error: ValidationFailure } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      error: {
        code: 'app.err.payload.invalid_json',
        message: 'Action request body must be a JSON object',
      },
    };
  }

  const raw = body as Record<string, unknown>;
  if (raw.app !== '1.0' && raw.app !== '1.1') {
    return {
      ok: false,
      error: {
        code: 'app.err.version.unsupported',
        message: `Unsupported app version: ${String(raw.app)}`,
        path: '/app',
      },
    };
  }

  if (typeof raw.action !== 'string' || raw.action.length === 0) {
    return {
      ok: false,
      error: {
        code: 'app.err.validation.missing_param',
        message: 'action field is required',
        path: '/action',
      },
    };
  }

  if (raw.params !== undefined) {
    if (typeof raw.params !== 'object' || raw.params === null || Array.isArray(raw.params)) {
      return {
        ok: false,
        error: {
          code: 'app.err.validation.param_type',
          message: 'params must be an object',
          path: '/params',
        },
      };
    }
  }

  // §3.4.2: additionalProperties forbidden on the Action Request.
  for (const key of Object.keys(raw)) {
    if (!ACTION_REQUEST_ROOT_KEYS.has(key)) {
      return {
        ok: false,
        error: {
          code: 'app.err.payload.invalid_json',
          message: `Unknown root field: ${key}`,
          path: `/${key}`,
        },
      };
    }
  }

  return {
    ok: true,
    raw,
    actionId: raw.action,
    requestStub: {
      app: raw.app as AppProtocolVersion,
      action: raw.action,
      params: (raw.params as Record<string, unknown> | undefined) ?? {},
    },
  };
}

/**
 * 1.0-only feature gate (SPEC §0.x): under a 1.0 selection, requests using
 * 1.1 constructs are rejected before params validate.
 */
export function checkV10FeatureGate(options: {
  actionDef: ActionDef;
  paramsRaw: Record<string, unknown>;
  extraChallenge?: string[];
  challengeContinuation?: boolean;
}): { ok: true } | { ok: false; error: ValidationFailure } {
  const { actionDef, paramsRaw, extraChallenge = [] } = options;
  if (extraChallenge.length > 0 || options.challengeContinuation) {
    return {
      ok: false,
      error: {
        code: 'app.err.feature.version_mismatch',
        message: 'Challenge continuation is a 1.1 construct',
        path: `/params/${extraChallenge[0] ?? 'otp'}`,
      },
    };
  }
  if (actionDef.bulk) {
    return {
      ok: false,
      error: {
        code: 'app.err.feature.version_mismatch',
        message: 'bulk is a 1.1 ActionDef construct',
        path: '/actions/bulk',
      },
    };
  }
  const input = actionDef.input ?? {};
  for (const [key, def] of Object.entries(input)) {
    if (V11_PARAM_TYPES.has(def.type) && key in paramsRaw) {
      return {
        ok: false,
        error: {
          code: 'app.err.feature.version_mismatch',
          message: `Param type ${def.type} is 1.1-only`,
          path: `/params/${key}`,
        },
      };
    }
    if (def.options_source) {
      return {
        ok: false,
        error: {
          code: 'app.err.feature.version_mismatch',
          message: 'options_source is a 1.1 construct',
          path: `/actions/input/${key}/options_source`,
        },
      };
    }
  }
  return { ok: true };
}

export function checkIdempotencyKeyHeader(
  actionDef: ActionDef,
  idempotencyKey: string | null | undefined,
): ValidationFailure | null {
  if (requiresIdempotencyKey(actionDef)) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      return {
        code: 'app.err.validation.idempotency_key_required',
        message: 'X-APP-Idempotency-Key (8–128 chars [A-Za-z0-9_-]+) is required for this action',
        path: '/headers/x-app-idempotency-key',
      };
    }
  } else if (idempotencyKey) {
    if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      return {
        code: 'app.err.validation.param_pattern',
        message: 'Invalid X-APP-Idempotency-Key format',
        path: '/headers/x-app-idempotency-key',
      };
    }
  }
  return null;
}

export function validateActionRequest(
  options: ValidateActionRequestOptions,
): ActionRequestValidationResult | ActionRequestValidationError {
  const ct = parseMediaType(options.contentType ?? undefined);
  if (ct !== MEDIA_ACTION) {
    return {
      ok: false,
      error: {
        code: 'app.err.negotiate.unsupported_media_type',
        message: `Content-Type must be ${MEDIA_ACTION}`,
        path: '/headers/content-type',
      },
    };
  }

  const parsed = parseActionRequestBody(options.body);
  if (!parsed.ok) return parsed;

  const { raw, actionId } = parsed;
  const actions = options.actions ?? {};
  const actionDef = actions[actionId];
  if (!actionDef) {
    return {
      ok: false,
      error: {
        code: 'app.err.action.not_found',
        message: `Unknown action: ${actionId}`,
        path: '/action',
      },
    };
  }

  const requestApp = raw.app as AppProtocolVersion;
  const selectedVersion = options.selectedVersion ?? requestApp;

  if (selectedVersion === '1.0' && requestApp === '1.1') {
    return {
      ok: false,
      error: {
        code: 'app.err.feature.version_mismatch',
        message: '1.1 construct used while selected version is 1.0',
        path: '/app',
      },
    };
  }

  const paramsRaw: Record<string, unknown> =
    (raw.params as Record<string, unknown> | undefined) ?? {};
  const challengeParams = new Set([
    ...CHALLENGE_CONTINUATION_PARAMS,
    ...(options.challengeParams ?? []),
  ]);
  const extraChallenge = Object.keys(paramsRaw).filter(
    (k) => challengeParams.has(k) && !(actionDef.input && k in actionDef.input),
  );

  if (selectedVersion === '1.0') {
    const gate = checkV10FeatureGate({
      actionDef,
      paramsRaw,
      extraChallenge,
      challengeContinuation: options.challengeContinuation,
    });
    if (!gate.ok) return gate;
  }

  const idemErr = checkIdempotencyKeyHeader(actionDef, options.idempotencyKey);
  if (idemErr) {
    return { ok: false, error: idemErr };
  }

  const paramMode = options.paramMode ?? actionDef.param_mode ?? 'strict';
  let params: Record<string, unknown> = { ...paramsRaw };

  if (options.validateParameters !== false) {
    const continuation = selectedVersion === '1.1' && extraChallenge.length > 0;
    const toValidate = { ...params };
    const extra: Record<string, unknown> = {};
    if (continuation) {
      for (const k of extraChallenge) {
        extra[k] = toValidate[k];
        delete toValidate[k];
      }
    }
    const paramResult = validateParams(actionDef.input, toValidate, { mode: paramMode });
    if (!paramResult.ok) {
      return { ok: false, error: paramResult.error };
    }
    params = { ...paramResult.params, ...extra };
    if (continuation && typeof extra.otp === 'string' && extra.otp.length > 16) {
      return {
        ok: false,
        error: {
          code: 'app.err.validation.param_range',
          message: 'OTP exceeds max 16 chars',
          path: '/params/otp',
        },
      };
    }
  }

  const request: ActionRequest = {
    app: selectedVersion,
    action: actionId,
    params,
  };
  if (raw.client && typeof raw.client === 'object' && !Array.isArray(raw.client)) {
    const kind = (raw.client as Record<string, unknown>).kind;
    if (kind !== undefined && !CLIENT_KINDS.has(kind as string)) {
      return {
        ok: false,
        error: {
          code: 'app.err.validation.param_type',
          message: `Unknown client.kind: ${String(kind)}`,
          path: '/client/kind',
        },
      };
    }
    request.client = raw.client as ActionRequest['client'];
  }
  if (raw.context && typeof raw.context === 'object' && !Array.isArray(raw.context)) {
    request.context = raw.context as ActionRequest['context'];
  }

  return {
    ok: true,
    request,
    params,
    actionDef,
    actionId,
  };
}
