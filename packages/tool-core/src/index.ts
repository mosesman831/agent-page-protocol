/**
 * @agent-page/tool-core public exports (CLIENT-TOOL-CONTRACT §11.2).
 */

export * from './types.js';
export {
  buildEnvelope,
  errorEnvelope,
  validateEnvelope,
  isOkStatus,
  isToolStatus,
  HoldSignal,
  EnvelopeError,
} from './envelope.js';
export {
  digest,
  stateDelta,
  fullStateDelta,
  type DigestOptions,
  type StateDeltaResult,
} from './digest.js';
export { SessionStore, generateSessionId, isSessionId, atomicWrite } from './session-store.js';
export { defaultHome } from './config.js';
export {
  HoldStore,
  encodeRawBody,
  decodeRawBody,
  decodeRawBodyString,
  sha256Hex,
  isUuidModeToken,
  assertNotUuidMode,
  holdKindToGateKind,
  gateKindToHoldKind,
  earliestUncleared,
  pendingGateOrder,
  resolveEarliestGate,
  appendGate,
  markGateCleared,
  publicHoldFromFile,
  resumeHintForKind,
  type PersistHoldInput,
  type InvokedHoldCommand,
} from './holds.js';
export { CredentialResolver, resolveCredentials } from './credentials.js';
export { exitCodeFor, exitCodeForErrorCode, registryExitMap } from './exit-codes.js';
export {
  watchOnce,
  watchLoop,
  watchResultFromOnce,
  floorIntervalMs,
  intervalFromManifest,
  pollAsyncOperationWithClient,
  type WatchOnceResult,
} from './watch.js';
export {
  featuresFromWellKnown,
  capabilitiesFromWellKnown,
  normalizeAuth,
  emptyFeatures,
  allV11FlagsFalse,
  featureEnabled,
  V11_FEATURE_FLAGS,
  type FeatureFlags,
} from './capabilities.js';
export {
  extractChallenge,
  holdKindForChallenge,
  isPageStepOtp,
  buildContinuationRawBody,
  continuationMutatedOnlyOtp,
  persistChallengeHold,
  checkChallengeUnattended,
  submitChallengeContinuation,
  applyChallengeFailure,
  nestedChallengeExceeded,
  type ChallengeDetails,
} from './challenge.js';
export {
  COMPLETE_HOLD_ACTION,
  isCompleteHoldAction,
  refuseCompleteHold,
  refuseHumanVerificationChallengeSubmit,
  assertNotWidgetFetch,
  incrementHumanHoldBudget,
  humanHoldCount,
  resetHumanHoldBudget,
  extractHumanHold,
  holdTokenHeaders,
  persistHumanHold,
  originalBodyForResume,
} from './human-hold.js';
export {
  parseEventRecord,
  parseSSE,
  lastEventIdHeader,
  longPollUrl,
  sseUrl,
  selectWatchTransport,
  sseAllowed,
  isKnownEventType,
  EVENT_ACCEPT_SSE,
  EVENT_ACCEPT_LONGPOLL,
  type ParsedSseEvent,
  type WatchTransport,
  type EventRecord,
} from './events.js';
export {
  parseSetAppResume,
  storeResumeToken,
  loadResumeToken,
  resumeHeaders,
  resumeFilePath,
  captureResumeFromHeaders,
  applyResumePresence,
  type ResumeToken,
} from './resume.js';
export {
  ToolRuntime,
  createRuntime,
  type CreateRuntimeOptions,
  type PageActionDef,
  type SessionPublic,
} from './runtime.js';
export {
  loadConfigFile,
  resolveConfig,
  assertNoConfigSecrets,
  type ResolvedToolConfig,
} from './config.js';
