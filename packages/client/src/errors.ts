/**
 * Client-side AppError + error envelope helpers (SPEC v0.4-Ultimate §9, Appendix A).
 */

import { APP_VERSION } from './media-types.js';
import type { ErrorEnvelope, ErrorDetails, StateNode } from './types.js';

export interface ErrorCodeMeta {
  code: string;
  httpStatus: number | null;
  retryable: boolean;
  soft?: boolean;
}

/** Exhaustive v1.0 registry (§9.3). Legacy `partial_results` removed. */
export const ERROR_REGISTRY: Record<string, ErrorCodeMeta> = {
  'app.err.negotiate.bad_accept': {
    code: 'app.err.negotiate.bad_accept',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.negotiate.not_acceptable': {
    code: 'app.err.negotiate.not_acceptable',
    httpStatus: 406,
    retryable: false,
  },
  'app.err.negotiate.diff_unsupported': {
    code: 'app.err.negotiate.diff_unsupported',
    httpStatus: 406,
    retryable: false,
  },
  'app.err.negotiate.unsupported_media_type': {
    code: 'app.err.negotiate.unsupported_media_type',
    httpStatus: 415,
    retryable: false,
  },
  'app.err.version.unsupported': {
    code: 'app.err.version.unsupported',
    httpStatus: 406,
    retryable: false,
  },
  'app.err.transport.method_not_allowed': {
    code: 'app.err.transport.method_not_allowed',
    httpStatus: 405,
    retryable: false,
  },
  'app.err.payload.unexpected_body': {
    code: 'app.err.payload.unexpected_body',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.payload.charset': { code: 'app.err.payload.charset', httpStatus: 400, retryable: false },
  'app.err.payload.invalid_json': {
    code: 'app.err.payload.invalid_json',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.payload.duplicate_key': {
    code: 'app.err.payload.duplicate_key',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.payload.too_large': {
    code: 'app.err.payload.too_large',
    httpStatus: 413,
    retryable: false,
  },
  'app.err.discovery.not_supported': {
    code: 'app.err.discovery.not_supported',
    httpStatus: null,
    retryable: false,
  },
  'app.err.discovery.invalid_well_known': {
    code: 'app.err.discovery.invalid_well_known',
    httpStatus: null,
    retryable: false,
  },
  'app.err.discovery.link_missing': {
    code: 'app.err.discovery.link_missing',
    httpStatus: 404,
    retryable: false,
  },
  'app.err.manifest.invalid': {
    code: 'app.err.manifest.invalid',
    httpStatus: 502,
    retryable: false,
  },
  'app.err.manifest.invalid_page_id': {
    code: 'app.err.manifest.invalid_page_id',
    httpStatus: 502,
    retryable: false,
  },
  'app.err.manifest.url_mismatch': {
    code: 'app.err.manifest.url_mismatch',
    httpStatus: null,
    retryable: false,
  },
  'app.err.manifest.strict_unknown': {
    code: 'app.err.manifest.strict_unknown',
    httpStatus: null,
    retryable: false,
  },
  'app.err.page.not_found': { code: 'app.err.page.not_found', httpStatus: 404, retryable: false },
  'app.err.page.gone': { code: 'app.err.page.gone', httpStatus: 410, retryable: false },
  'app.err.state.invalid_node': {
    code: 'app.err.state.invalid_node',
    httpStatus: 502,
    retryable: false,
  },
  'app.err.state.unknown_type': {
    code: 'app.err.state.unknown_type',
    httpStatus: null,
    retryable: false,
  },
  'app.err.state.string_too_long': {
    code: 'app.err.state.string_too_long',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.array_too_long': {
    code: 'app.err.state.array_too_long',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.object_too_large': {
    code: 'app.err.state.object_too_large',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.depth_exceeded': {
    code: 'app.err.state.depth_exceeded',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.number_overflow': {
    code: 'app.err.state.number_overflow',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.number_precision': {
    code: 'app.err.state.number_precision',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_date': {
    code: 'app.err.state.invalid_date',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_datetime': {
    code: 'app.err.state.invalid_datetime',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_enum': {
    code: 'app.err.state.invalid_enum',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.illegal_key': {
    code: 'app.err.state.illegal_key',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_file': {
    code: 'app.err.state.invalid_file',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.validation.missing_param': {
    code: 'app.err.validation.missing_param',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.unknown_param': {
    code: 'app.err.validation.unknown_param',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.param_type': {
    code: 'app.err.validation.param_type',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.param_enum': {
    code: 'app.err.validation.param_enum',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.param_range': {
    code: 'app.err.validation.param_range',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.param_pattern': {
    code: 'app.err.validation.param_pattern',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.idempotency_key_required': {
    code: 'app.err.validation.idempotency_key_required',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.action.not_found': {
    code: 'app.err.action.not_found',
    httpStatus: 404,
    retryable: false,
  },
  'app.err.action.unavailable': {
    code: 'app.err.action.unavailable',
    httpStatus: 409,
    retryable: true,
  },
  'app.err.action.conflict': { code: 'app.err.action.conflict', httpStatus: 409, retryable: true },
  'app.err.action.idempotency_conflict': {
    code: 'app.err.action.idempotency_conflict',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.action.version_required': {
    code: 'app.err.action.version_required',
    httpStatus: 428,
    retryable: false,
  },
  'app.err.action.confirmation_required': {
    code: 'app.err.action.confirmation_required',
    httpStatus: 428,
    retryable: false,
  },
  'app.err.action.confirmation_invalid': {
    code: 'app.err.action.confirmation_invalid',
    httpStatus: 403,
    retryable: false,
  },
  'app.err.action.forbidden_kind': {
    code: 'app.err.action.forbidden_kind',
    httpStatus: null,
    retryable: false,
  },
  'app.err.action.async_failed': {
    code: 'app.err.action.async_failed',
    httpStatus: 200,
    retryable: true,
    soft: true,
  },
  'app.err.action.async_pending': {
    code: 'app.err.action.async_pending',
    httpStatus: 200,
    retryable: true,
    soft: true,
  },
  'app.err.action.upload_unsupported': {
    code: 'app.err.action.upload_unsupported',
    httpStatus: 415,
    retryable: false,
  },
  'app.err.action.too_many': { code: 'app.err.action.too_many', httpStatus: 500, retryable: false },
  'app.err.action.invalid_def': {
    code: 'app.err.action.invalid_def',
    httpStatus: 502,
    retryable: false,
  },
  'app.err.action.invalid_id': {
    code: 'app.err.action.invalid_id',
    httpStatus: 502,
    retryable: false,
  },
  'app.err.diff.conflict': { code: 'app.err.diff.conflict', httpStatus: 409, retryable: true },
  'app.err.diff.conflict_persistent': {
    code: 'app.err.diff.conflict_persistent',
    httpStatus: null,
    retryable: false,
  },
  'app.err.diff.stale_base': { code: 'app.err.diff.stale_base', httpStatus: null, retryable: true },
  'app.err.diff.unsupported_op': {
    code: 'app.err.diff.unsupported_op',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.diff.invalid_path': {
    code: 'app.err.diff.invalid_path',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.diff.test_failed': {
    code: 'app.err.diff.test_failed',
    httpStatus: null,
    retryable: true,
  },
  'app.err.diff.apply_failed': {
    code: 'app.err.diff.apply_failed',
    httpStatus: null,
    retryable: true,
  },
  'app.err.navigation.invalid_url': {
    code: 'app.err.navigation.invalid_url',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.navigation.template_param': {
    code: 'app.err.navigation.template_param',
    httpStatus: null,
    retryable: false,
  },
  'app.err.navigation.redirect_loop': {
    code: 'app.err.navigation.redirect_loop',
    httpStatus: 508,
    retryable: false,
  },
  'app.err.navigation.cycle': {
    code: 'app.err.navigation.cycle',
    httpStatus: null,
    retryable: false,
  },
  'app.err.auth.required': { code: 'app.err.auth.required', httpStatus: 401, retryable: false },
  'app.err.auth.expired': { code: 'app.err.auth.expired', httpStatus: 401, retryable: false },
  'app.err.auth.forbidden': { code: 'app.err.auth.forbidden', httpStatus: 403, retryable: false },
  'app.err.auth.insufficient_scope': {
    code: 'app.err.auth.insufficient_scope',
    httpStatus: 403,
    retryable: false,
  },
  'app.err.auth.invalid_token': {
    code: 'app.err.auth.invalid_token',
    httpStatus: 401,
    retryable: false,
  },
  'app.err.auth.invalid_client': {
    code: 'app.err.auth.invalid_client',
    httpStatus: 401,
    retryable: false,
  },
  'app.err.auth.invalid_scope': {
    code: 'app.err.auth.invalid_scope',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.auth.invalid_grant': {
    code: 'app.err.auth.invalid_grant',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.auth.unsupported_grant': {
    code: 'app.err.auth.unsupported_grant',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.security.tls': { code: 'app.err.security.tls', httpStatus: null, retryable: false },
  'app.err.security.origin': { code: 'app.err.security.origin', httpStatus: 403, retryable: false },
  'app.err.security.csrf': { code: 'app.err.security.csrf', httpStatus: 403, retryable: false },
  'app.err.security.cross_origin': {
    code: 'app.err.security.cross_origin',
    httpStatus: null,
    retryable: false,
  },
  'app.err.rate.limited': { code: 'app.err.rate.limited', httpStatus: 429, retryable: true },
  'app.err.transport.timeout': {
    code: 'app.err.transport.timeout',
    httpStatus: 504,
    retryable: true,
  },
  'app.err.cache.revalidate_failed': {
    code: 'app.err.cache.revalidate_failed',
    httpStatus: 500,
    retryable: true,
  },
  'app.err.internal.server': { code: 'app.err.internal.server', httpStatus: 500, retryable: true },
  // client-synthesized: non-envelope HTTP failure from a fetch (status carried
  // on the AppError, not from this meta)
  'app.err.http_error': { code: 'app.err.http_error', httpStatus: null, retryable: false },
  'app.err.partial.results': {
    code: 'app.err.partial.results',
    httpStatus: 200,
    retryable: true,
    soft: true,
  },
  'app.err.partial.action': {
    code: 'app.err.partial.action',
    httpStatus: 200,
    retryable: true,
    soft: true,
  },
  'app.err.cache.stale': {
    code: 'app.err.cache.stale',
    httpStatus: 200,
    retryable: true,
    soft: true,
  },
  'app.err.policy.denied': { code: 'app.err.policy.denied', httpStatus: null, retryable: false },
  'app.err.version.version_mismatch': {
    code: 'app.err.version.version_mismatch',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.feature.unsupported': {
    code: 'app.err.feature.unsupported',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.feature.version_mismatch': {
    code: 'app.err.feature.version_mismatch',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.auth.failed': { code: 'app.err.auth.failed', httpStatus: 401, retryable: false },
  'app.err.auth.locked': { code: 'app.err.auth.locked', httpStatus: 403, retryable: true },
  'app.err.auth.identity_conflict': {
    code: 'app.err.auth.identity_conflict',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.auth.oauth_denied': {
    code: 'app.err.auth.oauth_denied',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.auth.oauth_code_spent': {
    code: 'app.err.auth.oauth_code_spent',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.auth.delegate_unattended': {
    code: 'app.err.auth.delegate_unattended',
    httpStatus: null,
    retryable: false,
  },
  'app.err.auth.flow_unknown': {
    code: 'app.err.auth.flow_unknown',
    httpStatus: 404,
    retryable: false,
  },
  'app.err.auth.session_invalid': {
    code: 'app.err.auth.session_invalid',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.auth.refresh_reuse': {
    code: 'app.err.auth.refresh_reuse',
    httpStatus: 401,
    retryable: false,
  },
  'app.err.auth.resume_invalid': {
    code: 'app.err.auth.resume_invalid',
    httpStatus: 401,
    retryable: false,
  },
  'app.err.auth.challenge_required': {
    code: 'app.err.auth.challenge_required',
    httpStatus: 428,
    retryable: false,
  },
  'app.err.auth.challenge_failed': {
    code: 'app.err.auth.challenge_failed',
    httpStatus: 401,
    retryable: false,
  },
  'app.err.auth.challenge_invalid': {
    code: 'app.err.auth.challenge_invalid',
    httpStatus: 403,
    retryable: false,
  },
  'app.err.auth.challenge_expired': {
    code: 'app.err.auth.challenge_expired',
    httpStatus: 401,
    retryable: false,
  },
  'app.err.auth.challenge_unattended': {
    code: 'app.err.auth.challenge_unattended',
    httpStatus: null,
    retryable: false,
  },
  'app.err.auth.challenge_nested': {
    code: 'app.err.auth.challenge_nested',
    httpStatus: null,
    retryable: false,
  },
  'app.err.hold.human_required': {
    code: 'app.err.hold.human_required',
    httpStatus: 428,
    retryable: true,
  },
  'app.err.hold.invalid': { code: 'app.err.hold.invalid', httpStatus: 403, retryable: false },
  'app.err.hold.expired': { code: 'app.err.hold.expired', httpStatus: 409, retryable: false },
  'app.err.hold.nested': { code: 'app.err.hold.nested', httpStatus: 409, retryable: false },
  'app.err.hold.rate': { code: 'app.err.hold.rate', httpStatus: 429, retryable: true },
  'app.err.hold.budget_exceeded': {
    code: 'app.err.hold.budget_exceeded',
    httpStatus: null,
    retryable: false,
  },
  'app.err.hold.invalid_widget': {
    code: 'app.err.hold.invalid_widget',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.hold.unattended': {
    code: 'app.err.hold.unattended',
    httpStatus: null,
    retryable: false,
  },
  'app.err.consent.required': {
    code: 'app.err.consent.required',
    httpStatus: 403,
    retryable: false,
  },
  'app.err.consent.unknown_purpose': {
    code: 'app.err.consent.unknown_purpose',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.consent.version_stale': {
    code: 'app.err.consent.version_stale',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.state.invalid_geopoint': {
    code: 'app.err.state.invalid_geopoint',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_range': {
    code: 'app.err.state.invalid_range',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_quantity': {
    code: 'app.err.state.invalid_quantity',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_embed': {
    code: 'app.err.state.invalid_embed',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_markdown': {
    code: 'app.err.state.invalid_markdown',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_media': {
    code: 'app.err.state.invalid_media',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.state.invalid_tree': {
    code: 'app.err.state.invalid_tree',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.validation.param_unit': {
    code: 'app.err.validation.param_unit',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.param_money': {
    code: 'app.err.validation.param_money',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.validation.param_file': {
    code: 'app.err.validation.param_file',
    httpStatus: 400,
    retryable: false,
  },
  'app.err.action.upload_expired': {
    code: 'app.err.action.upload_expired',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.action.options_source_invalid': {
    code: 'app.err.action.options_source_invalid',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.action.bulk_partial': {
    code: 'app.err.action.bulk_partial',
    httpStatus: 200,
    retryable: true,
    soft: true,
  },
  'app.err.commerce.illegal_transition': {
    code: 'app.err.commerce.illegal_transition',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.commerce.amount': { code: 'app.err.commerce.amount', httpStatus: 400, retryable: false },
  'app.err.commerce.payment_failed': {
    code: 'app.err.commerce.payment_failed',
    httpStatus: 409,
    retryable: false,
  },
  'app.err.commerce.not_an_order': {
    code: 'app.err.commerce.not_an_order',
    httpStatus: 500,
    retryable: false,
  },
  'app.err.events.unsupported': {
    code: 'app.err.events.unsupported',
    httpStatus: 404,
    retryable: false,
  },
  'app.err.events.mode': { code: 'app.err.events.mode', httpStatus: 400, retryable: false },
  'app.err.tool.usage': { code: 'app.err.tool.usage', httpStatus: null, retryable: false },
  'app.err.tool.not_a_tty': { code: 'app.err.tool.not_a_tty', httpStatus: null, retryable: false },
  'app.err.tool.hold_mismatch': {
    code: 'app.err.tool.hold_mismatch',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.hold_unsupported': {
    code: 'app.err.tool.hold_unsupported',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.session_missing': {
    code: 'app.err.tool.session_missing',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.session_locked': {
    code: 'app.err.tool.session_locked',
    httpStatus: null,
    retryable: true,
  },
  'app.err.tool.session_readonly': {
    code: 'app.err.tool.session_readonly',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.session_corrupt': {
    code: 'app.err.tool.session_corrupt',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.session_origin_mismatch': {
    code: 'app.err.tool.session_origin_mismatch',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.config_secret': {
    code: 'app.err.tool.config_secret',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.file_unreadable': {
    code: 'app.err.tool.file_unreadable',
    httpStatus: null,
    retryable: false,
  },
  'app.err.tool.internal': { code: 'app.err.tool.internal', httpStatus: null, retryable: false },
};

export interface BuildErrorOptions {
  message?: string;
  path?: string;
  httpStatus?: number | null;
  retryable?: boolean;
  details?: Record<string, StateNode>;
  recoverable_actions?: string[];
  request_id?: string;
  retry_after_ms?: number;
  confirmation_challenge?: string;
}

const DEFAULT_MESSAGES: Record<string, string> = {
  'app.err.diff.stale_base': 'Manifest version does not match diff base.version',
  'app.err.diff.test_failed': 'Diff test operation failed',
  'app.err.diff.apply_failed': 'Failed to apply diff',
  'app.err.diff.conflict': 'Page version conflict; re-GET and retry',
  'app.err.diff.conflict_persistent': 'Persistent page version conflict after retry',
  'app.err.diff.invalid_path': 'Diff path not allowed',
  'app.err.navigation.cycle': 'Navigation cycle detected',
  'app.err.navigation.redirect_loop': 'Too many redirects',
  'app.err.navigation.invalid_url': 'Invalid navigation URL',
  'app.err.navigation.template_param': 'Missing required template parameter',
  'app.err.security.cross_origin': 'Cross-origin request blocked',
  'app.err.action.confirmation_required': 'Confirmation required before executing this action',
  'app.err.action.not_found': 'Action not found',
  'app.err.action.async_failed': 'Async operation failed',
  'app.err.action.version_required': 'X-APP-If-Match-Version required',
  'app.err.policy.denied': 'Action blocked by client policy',
  'app.err.auth.required': 'Authentication required',
  'app.err.auth.expired': 'Authentication expired',
  'app.err.manifest.invalid': 'Invalid page manifest',
  'app.err.payload.invalid_json': 'Response body is not valid JSON',
  'app.err.rate.limited': 'Rate limited',
  'app.err.transport.timeout': 'Request timed out',
  'app.err.page.not_found': 'Page not found',
  'app.err.page.gone': 'Page permanently gone',
  'app.err.state.number_precision': 'Integer exceeds safe precision',
  'app.err.transport.method_not_allowed': 'HTTP method not allowed',
  'app.err.negotiate.unsupported_media_type': 'Unsupported media type',
  'app.err.payload.unexpected_body': 'Unexpected request body',
  'app.err.partial.results': 'Partial results',
};

export function getErrorMeta(code: string): ErrorCodeMeta {
  return (
    ERROR_REGISTRY[code] ?? {
      code,
      httpStatus: 500,
      retryable: false,
    }
  );
}

export function isSoftErrorCode(code: string): boolean {
  return ERROR_REGISTRY[code]?.soft === true;
}

export function buildErrorEnvelope(code: string, options: BuildErrorOptions = {}): ErrorEnvelope {
  const meta = getErrorMeta(code);
  const message = (options.message ?? DEFAULT_MESSAGES[code] ?? code).slice(0, 500);
  const error: ErrorDetails = {
    code,
    message,
    retryable: options.retryable ?? meta.retryable,
    http_status: options.httpStatus !== undefined ? options.httpStatus : meta.httpStatus,
  };
  if (options.path !== undefined) error.path = options.path;
  if (options.details) error.details = options.details;
  if (options.recoverable_actions) error.recoverable_actions = options.recoverable_actions;
  if (options.request_id) error.request_id = options.request_id;
  if (options.retry_after_ms !== undefined) error.retry_after_ms = options.retry_after_ms;
  if (options.confirmation_challenge) error.confirmation_challenge = options.confirmation_challenge;
  return { app: APP_VERSION, error };
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as ErrorEnvelope;
  return (
    (e.app === '1.0' || e.app === '1.1') &&
    !!e.error &&
    typeof e.error.code === 'string' &&
    typeof e.error.message === 'string'
  );
}

export class AppError extends Error {
  readonly envelope: ErrorEnvelope;
  readonly httpStatus: number | null;
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(code: string, options: BuildErrorOptions = {}) {
    const envelope = buildErrorEnvelope(code, options);
    super(envelope.error.message);
    this.name = 'AppError';
    this.envelope = envelope;
    this.code = envelope.error.code;
    this.httpStatus = envelope.error.http_status;
    this.requestId = envelope.error.request_id;
    this.retryAfterMs = envelope.error.retry_after_ms;
  }

  static fromEnvelope(envelope: ErrorEnvelope, fallbackStatus?: number | null): AppError {
    const challenge =
      envelope.error.confirmation_challenge ??
      (envelope.error.details?.confirmation_challenge as { value?: string } | undefined)?.value;
    return new AppError(envelope.error.code, {
      message: envelope.error.message,
      path: envelope.error.path,
      httpStatus: envelope.error.http_status ?? fallbackStatus ?? null,
      retryable: envelope.error.retryable,
      details: envelope.error.details,
      recoverable_actions: envelope.error.recoverable_actions,
      request_id: envelope.error.request_id,
      retry_after_ms: envelope.error.retry_after_ms,
      confirmation_challenge: typeof challenge === 'string' ? challenge : undefined,
    });
  }
}
