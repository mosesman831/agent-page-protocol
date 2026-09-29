/**
 * Local @agent-page/tool-core adapter (CLIENT-TOOL-CONTRACT §11.2).
 * Switch callers to `import { ... } from '@agent-page/tool-core'` when that package lands.
 */

export type * from './types.js';
export { buildEnvelope, errorEnvelope, HoldSignal, isOkStatus } from './envelope.js';
export { exitCodeFor, exitCodeForErrorCode } from './exit-codes.js';
export { digest, stateDelta } from './digest.js';
export {
  SessionStore,
  SessionStoreError,
  defaultHome,
  generateSessionId,
} from './session-store.js';
export {
  HoldStore,
  encodeRawBody,
  decodeRawBody,
  publicHoldFromFile,
  resumeHintFor,
  holdKindToGateKind,
  sha256Hex,
} from './holds.js';
export { CredentialResolver } from './credentials.js';
export { resolveConfig } from './config.js';
export type { ResolvedConfig } from './config.js';
export {
  capabilitiesFromWellKnown,
  featuresFromWellKnown,
  siteNameFromWellKnown,
  entryUrlsFromWellKnown,
  normalizeAuth,
} from './capabilities.js';
export { createRuntime } from './runtime.js';
export type { CreateRuntimeOptions, ToolRuntime, ActOptions } from './runtime.js';
