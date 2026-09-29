/**
 * SPEC §19.3 + §27 normative vector catalog (TV-01..TV-152).
 */

import type { ConformanceLevel, VectorMeta } from './types.js';

function levelsFor(number: number): ConformanceLevel[] {
  if (number <= 21) return ['L0', 'L1'];
  if (number <= 36) return ['L2', 'L3'];
  if (number <= 47) return ['L3', 'L4'];
  if (number <= 60) return ['L4', 'L5', 'L6', 'client'];
  if (number <= 89) return ['L7'];
  return ['L8'];
}

const SCENARIOS: Array<{
  number: number;
  name: string;
  description: string;
}> = [
  {
    number: 1,
    name: 'Empty state page',
    description: 'Empty state:{} with no actions; valid manifest',
  },
  {
    number: 2,
    name: 'Null nodes and invalid string value',
    description: 'Nested type:null valid; string node with value:null rejected',
  },
  {
    number: 3,
    name: 'Empty collection pagination',
    description: 'Empty table with end-of-collection pagination metadata',
  },
  {
    number: 4,
    name: 'Pagination inconsistency',
    description: 'cursor:null + has_more:true treated as end with warning',
  },
  {
    number: 5,
    name: 'Enum value not in options',
    description: 'Enum value outside options → app.err.state.invalid_enum',
  },
  {
    number: 6,
    name: 'Enum duplicate or too many options',
    description: 'Duplicate options or 257 options → invalid_enum',
  },
  {
    number: 7,
    name: 'Negative zero normalization',
    description: 'Number -0 serializes and compares as 0',
  },
  {
    number: 8,
    name: 'Integer precision limit',
    description: '2^53 rejected; 2^53−1 allowed',
  },
  {
    number: 9,
    name: 'Money scale integer constraint',
    description: 'scale:2 with non-integer value rejected',
  },
  {
    number: 10,
    name: 'Invalid calendar date',
    description: 'Date 2026-02-30 → app.err.state.invalid_date',
  },
  {
    number: 11,
    name: 'Datetime without offset',
    description: 'Datetime missing timezone → invalid_datetime',
  },
  {
    number: 12,
    name: 'Illegal object key',
    description: 'Key __proto__ under state → illegal_key',
  },
  {
    number: 13,
    name: 'Table row field count',
    description: 'Row length ≠ fields count → invalid_node',
  },
  {
    number: 14,
    name: 'Invalid file name',
    description: 'File name containing / or \\ → invalid_file',
  },
  {
    number: 15,
    name: 'Invalid file URL scheme',
    description: 'http file URL on non-loopback → invalid_file',
  },
  {
    number: 16,
    name: 'Invalid well-known manifest',
    description: 'Bare-string capabilities → invalid_well_known',
  },
  {
    number: 17,
    name: 'Well-known trailing slash',
    description: '308 redirect to /.well-known/agent-page',
  },
  {
    number: 18,
    name: 'Dual-mode Accept */*',
    description: 'Accept */* returns HTML or server default non-APP',
  },
  {
    number: 19,
    name: 'Diff-only negotiation',
    description: 'Accept diff only when action cannot produce diff → 406 or full',
  },
  {
    number: 20,
    name: 'GET with body',
    description: 'GET with body → 400 unexpected_body',
  },
  {
    number: 21,
    name: 'Method not allowed',
    description: 'PUT/DELETE → 405 method_not_allowed + Allow',
  },
  {
    number: 22,
    name: 'Params are plain JSON',
    description: 'StateNode-wrapped params → param_type',
  },
  {
    number: 23,
    name: 'Missing required param',
    description: 'Missing required param → missing_param with error.path',
  },
  {
    number: 24,
    name: 'Unknown param strict mode',
    description: 'Unknown key with strict param_mode → unknown_param',
  },
  {
    number: 25,
    name: 'Unknown param lenient mode',
    description: 'Unknown key with lenient param_mode ignored',
  },
  {
    number: 26,
    name: 'Financial idempotency required',
    description: 'Financial action without idempotency key → 400',
  },
  {
    number: 27,
    name: 'Idempotency replay',
    description: 'Same key + identical body returns stored response',
  },
  {
    number: 28,
    name: 'Idempotency conflict',
    description: 'Same key + different body → 409 idempotency_conflict',
  },
  {
    number: 29,
    name: 'Idempotency in-flight conflict',
    description: 'Key while first execution in flight → 409 action.conflict',
  },
  {
    number: 30,
    name: 'Stale If-Match-Version',
    description: 'Stale version → 409 diff.conflict; re-GET and retry',
  },
  {
    number: 31,
    name: 'Persistent diff conflict',
    description: 'Second consecutive conflict → diff.conflict_persistent',
  },
  {
    number: 32,
    name: 'Diff test op failure',
    description: 'test op fails mid-apply → whole diff discarded',
  },
  {
    number: 33,
    name: 'Diff atomic rollback',
    description: 'Op 3 of 5 fails → pre-diff manifest retained',
  },
  {
    number: 34,
    name: 'Diff invalid path',
    description: 'Patch /page/version → invalid_path',
  },
  {
    number: 35,
    name: 'Whole-table replace',
    description: 'Single replace on /state/results succeeds',
  },
  {
    number: 36,
    name: 'Empty diff array',
    description: 'Empty diff is legal no-op',
  },
  {
    number: 37,
    name: 'Navigate must not return 200 manifest',
    description: 'Navigate 200 + manifest is protocol violation',
  },
  {
    number: 38,
    name: 'Navigate 303 follow',
    description: '303 redirect; client re-GETs Location with APP Accept',
  },
  {
    number: 39,
    name: 'Mismatched navigate headers',
    description: 'Location ≠ X-APP-Navigate → fail closed',
  },
  {
    number: 40,
    name: 'Unicode template encoding',
    description: 'Unicode path params percent-encoded UTF-8',
  },
  {
    number: 41,
    name: 'Navigation cycle detection',
    description: 'A→B→A→B→A within 8 entries → navigation.cycle',
  },
  {
    number: 42,
    name: 'Redirect loop detection',
    description: '6-hop redirect chain → navigation.redirect_loop',
  },
  {
    number: 43,
    name: 'Cross-origin navigation blocked',
    description: 'Cross-origin navigates_to not followed',
  },
  {
    number: 44,
    name: 'CSRF Origin precedence',
    description: 'Mismatched Origin + valid X-APP-Origin → 403 csrf',
  },
  {
    number: 45,
    name: 'Mode A confirmation flow',
    description: '428 → approve identical body + token → 200',
  },
  {
    number: 46,
    name: 'Confirmation replay or mutation',
    description: 'Token replay or body mutation → confirmation_invalid',
  },
  {
    number: 47,
    name: 'Mode B rejected for agents',
    description: 'uuid-mode confirmation with agent client → 403',
  },
  {
    number: 48,
    name: 'Rate limit Retry-After',
    description: '429 Retry-After: client waits before retry',
  },
  {
    number: 49,
    name: 'Auth refresh retry-once',
    description: '401 → refresh once → 200; second 401 surfaces',
  },
  {
    number: 50,
    name: 'Async operation succeeded',
    description: '202 → poll → terminal succeeded state applied',
  },
  {
    number: 51,
    name: 'Async operation failed',
    description: 'Terminal failed → soft async_failed + recoverable_actions',
  },
  {
    number: 52,
    name: 'Soft error whitelist',
    description: 'Hard error code on 200 outside whitelist → manifest.invalid',
  },
  {
    number: 53,
    name: 'CORS read vs write',
    description: 'Cross-origin GET allowed; POST rejected',
  },
  {
    number: 54,
    name: 'Conditional GET 304',
    description: 'Matching ETag → 304 empty body',
  },
  {
    number: 55,
    name: 'Login logout cache purge',
    description: 'Private cache purged on login/logout',
  },
  {
    number: 56,
    name: 'Signed file URL revalidation',
    description: 'File URL 403 with fresh manifest → revalidate parent',
  },
  {
    number: 57,
    name: 'Upload unsupported',
    description: 'Multipart upload without file_upload → 415',
  },
  {
    number: 58,
    name: 'Table truncation metadata',
    description: 'Silent table truncation without meta.truncated fails',
  },
  {
    number: 59,
    name: 'Extension unknown message',
    description: 'Unknown extension message dropped without throw',
  },
  {
    number: 60,
    name: 'Diff round-trip coherence',
    description: 'GET → POST diff → apply equals fresh GET semantically',
  },
  {
    number: 61,
    name: 'Feature object present, 1.1 selected',
    description: '1.1 well-known with features and protocol_version 1.1',
  },
  {
    number: 62,
    name: '1.0-only client to 1.1 server',
    description: 'Selected 1.0; no type:order; no 1.1-only node types',
  },
  {
    number: 63,
    name: '1.1 client to 1.0 server (no features)',
    description: 'discover() sets 1.1 flags false; no X-APP-Challenge',
  },
  {
    number: 64,
    name: 'Well-known identity_flows without flows.login',
    description: 'invalid_well_known when identity_flows lacks login',
  },
  {
    number: 65,
    name: '401 includes login_url when identity_flows',
    description: 'Unauthenticated GET /account includes login_url and flow_id',
  },
  {
    number: 66,
    name: 'Password login success (no MFA)',
    description: 'submit_credentials sets session cookie; no password in body',
  },
  {
    number: 67,
    name: 'Bad password generic failure',
    description: '401 auth.failed without user-vs-password distinction',
  },
  {
    number: 68,
    name: 'Login lockout',
    description: '5 failed logins → 403 auth.locked with Retry-After',
  },
  {
    number: 69,
    name: 'Logout purges private cache (extends TV-55)',
    description: 'logout then GET /account 401; private cache miss',
  },
  {
    number: 70,
    name: 'Signup duplicate',
    description: '409 identity_conflict without confirming which field',
  },
  {
    number: 71,
    name: 'Recovery no enumeration',
    description: 'known and unknown emails return the same 200 shape',
  },
  {
    number: 72,
    name: 'OAuth start is same-origin; delegates_to is https',
    description: 'start page is APP; IdP URL is https off-origin',
  },
  {
    number: 73,
    name: 'OAuth callback GET does not exchange',
    description: 'callback body has no code; complete_oauth present',
  },
  {
    number: 74,
    name: 'OAuth complete then replay code',
    description: 'second complete_oauth → 409 oauth_code_spent',
  },
  {
    number: 75,
    name: 'OAuth GET-only client never gets tokens',
    description: 'callback has no JWT prefix or access_token keys',
  },
  {
    number: 76,
    name: 'Delegate unattended (client)',
    description: 'no onDelegate → delegate_unattended; IdP not fetched',
  },
  {
    number: 77,
    name: 'Session refresh success',
    description: 'refresh_session rotates access token',
  },
  {
    number: 78,
    name: 'Refresh reuse detection',
    description: 'old refresh → 401 refresh_reuse or expired; family revoked',
  },
  {
    number: 79,
    name: 'MFA page-step',
    description: 'valid password → 200 pending_mfa with challenge; not 428',
  },
  {
    number: 80,
    name: 'Submit correct OTP',
    description: 'submit_otp → authenticated; challenge spent',
  },
  {
    number: 81,
    name: 'Wrong OTP decrements attempts',
    description: '401 challenge_failed; attempts_remaining decremented',
  },
  { number: 82, name: 'OTP lockout', description: '0 remaining → 403 auth.locked' },
  { number: 83, name: 'OTP expired', description: 'past expires_at → 401 challenge_expired' },
  {
    number: 84,
    name: 'Inline 428 challenge + continuation exception',
    description: 'same key + otp succeeds; not idempotency_conflict',
  },
  {
    number: 85,
    name: 'Continuation mutating password',
    description: 'changed password on continuation → 409 idempotency_conflict',
  },
  { number: 86, name: 'Challenge header wrong id', description: '403 challenge_invalid' },
  {
    number: 87,
    name: 'Agent without onChallenge',
    description: 'challenge_unattended; no busy loop',
  },
  {
    number: 88,
    name: 'Passkey challenge shape',
    description: 'kind webauthn; public_key object; no private key',
  },
  {
    number: 89,
    name: 'Magic-link poll interval',
    description: 'poll ≥ poll_interval_ms; complete via mutate',
  },
  {
    number: 90,
    name: 'Hold 428 on action',
    description: '428 human_required; verify_url same-origin; agent_solvable false',
  },
  {
    number: 91,
    name: 'Agent POST complete_hold',
    description: '403 hold.invalid; hold not cleared',
  },
  { number: 92, name: 'Hold timeout', description: 'after TTL, original POST 409 hold.expired' },
  { number: 93, name: 'Fourth hold in 10 minutes', description: '429 hold.rate with Retry-After' },
  {
    number: 94,
    name: 'Client budget after 3 holds in one task',
    description: 'hold.budget_exceeded; no 4th original-action retry',
  },
  { number: 95, name: 'Nested hold', description: '409 hold.nested' },
  {
    number: 96,
    name: 'widget_url http non-loopback',
    description: 'server must not emit; client refuses invalid_widget',
  },
  {
    number: 97,
    name: 'Resume after hold clear',
    description: 'Hold-Token + same key+body → 200; token single-use',
  },
  {
    number: 98,
    name: 'Agent GET widget_url with APP Accept (IG-08)',
    description: 'client never GETs widget_url',
  },
  {
    number: 99,
    name: 'Consent required blocks analytics action',
    description: '403 consent.required; missing includes analytics',
  },
  {
    number: 100,
    name: 'Grant then invoke',
    description: 'grant_consent then analytics action 200',
  },
  { number: 101, name: 'Revoke then invoke', description: '403 consent.required again' },
  {
    number: 102,
    name: 'necessary cannot be revoked',
    description: 'necessary still granted after revoke attempt',
  },
  { number: 103, name: 'Stale consent version', description: '409 consent.version_stale' },
  {
    number: 104,
    name: 'Consent is state not HTML (agent-native)',
    description: 'state.consent on APP GET; HTML Accept 406',
  },
  { number: 105, name: 'Geopoint valid param', description: 'POST lat/lng 200' },
  { number: 106, name: 'Geopoint lat 91', description: '400 param_range path /params/<key>/lat' },
  { number: 107, name: 'date_range from > to', description: '400 param_range' },
  { number: 108, name: 'datetime_range naive', description: '400 param_type (no offset)' },
  { number: 109, name: 'quantity unit not in list', description: '400 param_unit' },
  { number: 110, name: 'money non-integer amount', description: '400 param_money' },
  {
    number: 111,
    name: '1.0 projection of geopoint',
    description: 'type object with lat/lng number nodes',
  },
  {
    number: 112,
    name: 'options_source happy path',
    description: 'search_airports replaces suggestions; ≤ 64 rows',
  },
  {
    number: 113,
    name: 'options_source target is mutate (publish)',
    description: 'client ignores; MUST NOT POST the mutate',
  },
  {
    number: 114,
    name: 'Typeahead shorter than min_query_length',
    description: 'client MUST NOT send',
  },
  {
    number: 115,
    name: 'Multipart still works (regression TV-57 inverse)',
    description: 'file_upload accepts multipart 200; without 415',
  },
  {
    number: 116,
    name: 'Presign PUT does not send APP cookie cross-origin',
    description: 'Cookie header absent on PUT',
  },
  { number: 117, name: 'Presign expired slot', description: '409 upload_expired' },
  { number: 118, name: 'sha256 mismatch', description: '400 param_file' },
  {
    number: 119,
    name: 'Order illegal transition paid -> draft',
    description: '409 illegal_transition',
  },
  {
    number: 120,
    name: 'Pay delegate requires financial confirmation',
    description: '428 confirmation_required then delegate; bank not fetched',
  },
  { number: 121, name: 'Refund over amount', description: '400 commerce.amount' },
  {
    number: 122,
    name: 'Cancel from delivered forbidden in fixture',
    description: '409 action.unavailable or illegal_transition',
  },
  {
    number: 123,
    name: '3DS callback GET no capture',
    description: 'no paid until complete_payment',
  },
  {
    number: 124,
    name: 'Resume valid rehydrate',
    description: 'X-APP-Resume → 200 authenticated or 401 expired refresh_available',
  },
  { number: 125, name: 'Resume invalid', description: '401 resume_invalid' },
  {
    number: 126,
    name: 'Multi-client version conflict',
    description: 'stale If-Match → 409 diff.conflict',
  },
  {
    number: 127,
    name: 'session_epoch changes cache key',
    description: 'logout-all; old ETag is not 304 of private page',
  },
  {
    number: 128,
    name: 'SSE subscribe + state.changed',
    description: 'event type=state.changed version matches',
  },
  {
    number: 129,
    name: 'SSE Last-Event-ID replay',
    description: 'reconnect receives only subsequent events',
  },
  { number: 130, name: 'Long-poll 204', description: 'no changes timeout_ms=1000 → 204 within 2s' },
  {
    number: 131,
    name: 'Event auth failure',
    description: 'SSE GET without credentials → 401 envelope not stream',
  },
  { number: 132, name: 'Event page_url cross-origin', description: '403 security.cross_origin' },
  {
    number: 133,
    name: 'WS query token rejected if events_ws on',
    description: 'close; no ok frame (skip if events_ws false)',
  },
  {
    number: 134,
    name: 'Bulk all_or_nothing rollback',
    description: '409; first item not committed',
  },
  { number: 135, name: 'Bulk best_effort partial', description: '200; table mixed ok flags' },
  { number: 136, name: 'Bulk without feature', description: '400 feature.unsupported' },
  {
    number: 137,
    name: 'Deep focus echo',
    description: 'page.focus == /state/results; page.url includes query',
  },
  { number: 138, name: 'Deep focus invalid pointer', description: '200; focus omitted' },
  {
    number: 139,
    name: 'Timezone header does not rewrite datetime value',
    description: 'UTC value unchanged',
  },
  {
    number: 140,
    name: 'Localized message, stable code',
    description: 'missing_param code stable; message MAY differ',
  },
  {
    number: 141,
    name: 'Unknown action-request root keys rejected',
    description: '400 app.err.payload.invalid_json (§3.4.2)',
  },
  {
    number: 142,
    name: 'Diff documents carry negotiated version',
    description: 'diff.app == selected; 1.0 diffs project cleanly onto v1.0 base',
  },
  {
    number: 143,
    name: 'Malformed JSON yields APP error envelope',
    description: '400 app.err.payload.invalid_json with error media type (never HTML)',
  },
  {
    number: 144,
    name: 'Leading BOM rejected',
    description: '400 app.err.payload.charset (§3.2)',
  },
  {
    number: 145,
    name: 'Invalid UTF-8 rejected',
    description: '400 app.err.payload.charset (§3.2)',
  },
  {
    number: 146,
    name: 'Body over 64 KiB cap rejected',
    description: '413 app.err.payload.too_large; envelope stamped negotiated version',
  },
  {
    number: 147,
    name: 'Publish-time options_source validation',
    description: 'dangling options_source.action -> 500 app.err.action.options_source_invalid',
  },
  {
    number: 148,
    name: 'Publish-time state caps enforced',
    description: 'table >10000 rows -> 500 app.err.state.array_too_long',
  },
  {
    number: 149,
    name: 'Unknown action rejected',
    description: '404 app.err.action.not_found',
  },
  {
    number: 150,
    name: 'Version negotiation error codes',
    description:
      'unsupported offer -> 406 version.unsupported; v= mismatch -> 400 version.version_mismatch',
  },
  {
    number: 151,
    name: 'Param enum + pattern validation',
    description: 'param_enum / param_pattern 400s',
  },
  {
    number: 152,
    name: 'Version-gated constructs + handler failure',
    description: 'feature.version_mismatch; internal.server JSON envelope',
  },
  {
    number: 153,
    name: 'OAuth IdP denial',
    description: 'callback error= -> oauth_denied 400',
  },
  {
    number: 154,
    name: 'Illegal session transition',
    description: 'logout anonymous/expired -> session_invalid 409',
  },
  {
    number: 155,
    name: 'Consent catalog',
    description: 'undeclared purpose -> consent.unknown_purpose 400',
  },
  {
    number: 156,
    name: 'Illegal hold widget_url',
    description: 'http non-loopback widget_url -> hold.invalid_widget 500',
  },
  {
    number: 157,
    name: 'Events mode rejection',
    description: 'bad mode -> events.mode 400; sse opens stream',
  },
  {
    number: 158,
    name: 'Nested-challenge budget',
    description:
      'declared meta.flow.step_count=3 completes a 3-factor chain; declared 2 -> client challenge_nested',
  },
];

export function metaFor(number: number): VectorMeta {
  const entry = SCENARIOS.find((s) => s.number === number);
  if (!entry) {
    throw new Error(`Unknown vector number: ${number}`);
  }
  const id = `TV-${String(number).padStart(2, '0')}`;
  return {
    id,
    number: entry.number,
    name: entry.name,
    description: entry.description,
    specRef: number <= 60 ? `SPEC §19.3 ${id}` : `SPEC §27 ${id}`,
    levels: levelsFor(number),
  };
}

export const VECTOR_CATALOG: VectorMeta[] = SCENARIOS.map((s) => metaFor(s.number));
