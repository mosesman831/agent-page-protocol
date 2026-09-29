/**
 * @agent-page/client — public exports
 */

export * from './media-types.js';
export * from './types.js';
export {
  ERROR_REGISTRY,
  buildErrorEnvelope,
  getErrorMeta,
  isErrorEnvelope,
  isSoftErrorCode,
  AppError,
  type BuildErrorOptions,
  type ErrorCodeMeta,
} from './errors.js';
export { ManifestCache, type CacheEntry, type ManifestCacheOptions } from './cache.js';
export {
  applyDiff,
  applyDiffDocument,
  isAllowedDiffPath,
  isTableCellPath,
  validateDiffOps,
  isDiffDocument,
  isPageManifest,
  type ApplyDiffResult,
  type ApplyDiffSuccess,
  type ApplyDiffFailure,
} from './diff.js';
export {
  resolveAppUrl,
  normalizeAppUrl,
  normalizePercentEncoding,
  removeDotSegments,
  expandUrlTemplate,
  expandNavigate,
  canNavigateWithoutPost,
  assertSameOrigin,
  isSameOrigin,
  extractOrigin,
  isLoopbackHost,
  requireNavigateLocation,
  NavigationStack,
  MAX_REDIRECTS,
  MAX_STACK,
  CYCLE_WINDOW,
  CYCLE_THRESHOLD,
} from './navigate.js';
export {
  ActionPolicy,
  policyLevelFor,
  readAmountFromState,
  requiresIdempotencyKey,
  isIdempotentAction,
  type ActionPolicyOptions,
  type PolicyLevel,
} from './policy.js';
export {
  redactSecrets,
  redactHeaders,
  redactSecretParams,
  stripForLlm,
  summarizeArrays,
  prepareForPlanner,
  REDACTED,
} from './redact.js';
export {
  AppHttpClient,
  ACCEPT_GET,
  ACCEPT_ACTION,
  parseRetryAfterMs,
  type AppHttpOptions,
  type AppResponseMeta,
  type FetchLike,
  type GetAuthHeaders,
  type GetResumeToken,
  type OnAuthRefresh,
} from './http.js';
export { hydrate, type HydrateOptions, type HydrateContext } from './hydrate.js';
export {
  ActionDispatcher,
  PageMutex,
  listActions,
  findAction,
  generateIdempotencyKey,
  type OnConfirm,
  type OnChallenge,
  type OnHold,
  type OnConsent,
  type OnDelegate,
  type InvokeOptions,
  type ActionDispatcherOptions,
} from './actions.js';
// pollAsyncOperation is ActionDispatcher.pollAsyncOperation (K3 MF-7)
export {
  AgentClient,
  AgentRuntime,
  searchFilterBook,
  type AgentClientOptions,
  type DiscoverResult,
  type EventSubscription,
} from './agent.js';
export {
  parseFeatures,
  emptyFeatureFlags,
  hasFeature,
  unwrapStateNode,
  readCapabilities,
} from './features.js';
export { parseSetAppResume, ResumeStore } from './resume.js';
export {
  collectChallenge,
  parseChallengeObject,
  challengeFromManifest,
  type ChallengeRequest,
} from './challenge.js';
export {
  HoldBudget,
  HOLD_BUDGET_PER_TASK,
  collectHold,
  parseHoldObject,
  assertNotCompleteHold,
  type HoldRequest,
} from './hold.js';
export {
  parseConsent,
  collectConsent,
  filterGrantPurposes,
  type ConsentRequest,
} from './consent.js';
export {
  parseSseFrame,
  parseSseEventRecords,
  parseEventRecordJson,
  splitSseFrames,
  subscribeEvents,
  longPollEvent,
  isEventRecord,
} from './events.js';
export { typeahead, shouldSendTypeahead, TypeaheadController } from './typeahead.js';
export {
  uploadFile,
  presignPut,
  sha256Hex,
  type UploadBytes,
  type UploadReceipt,
} from './upload.js';
export {
  discoverOrigin,
  wellKnownUrl,
  parseFlows,
  runLogin,
  runLogout,
  runSignup,
  runRecovery,
  runResume,
  loginUrlFromError,
} from './identity.js';
export * from './features.js';
export * from './identity.js';
export * from './challenge.js';
export * from './hold.js';
export * from './consent.js';
export * from './events.js';
export * from './typeahead.js';
export * from './upload.js';
export * from './resume.js';
export * from './file.js';
export * from './auth.js';
