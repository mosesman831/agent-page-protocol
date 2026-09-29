/**
 * Closed tagged-union messaging for APP extension (§14 / §24).
 * Envelope: { app_ext, type, request_id, tab_id, payload }
 * Unknown types are dropped (TV-59) - never thrown at receivers.
 *
 * app_ext "1.0" for v0.4 types; "1.1" for §24.1 types so old receivers drop them.
 */

export const APP_EXT = '1.0';
export const APP_EXT_V11 = '1.1';

/** Closed catalog - types outside this set are ignored. */
export const MessageType = Object.freeze({
  DETECT_RESULT: 'DETECT_RESULT',
  FETCH_MANIFEST: 'FETCH_MANIFEST',
  MANIFEST_READY: 'MANIFEST_READY',
  MANIFEST_ERROR: 'MANIFEST_ERROR',
  INVOKE_ACTION: 'INVOKE_ACTION',
  ACTION_RESULT: 'ACTION_RESULT',
  NAVIGATE: 'NAVIGATE',
  CONFIRM_REQUEST: 'CONFIRM_REQUEST',
  CONFIRM_RESPONSE: 'CONFIRM_RESPONSE',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  PING: 'PING',
  PONG: 'PONG',
  // §24.1 (app_ext 1.1)
  CHALLENGE_REQUEST: 'CHALLENGE_REQUEST',
  CHALLENGE_RESPONSE: 'CHALLENGE_RESPONSE',
  HOLD_REQUEST: 'HOLD_REQUEST',
  HOLD_RESPONSE: 'HOLD_RESPONSE',
  CONSENT_PROMPT: 'CONSENT_PROMPT',
  CONSENT_RESPONSE: 'CONSENT_RESPONSE',
  DELEGATE_OPEN: 'DELEGATE_OPEN',
  EVENT_PUSH: 'EVENT_PUSH',
  SESSION_EPOCH: 'SESSION_EPOCH',
  RESUME_STORE: 'RESUME_STORE',
});

/** Types that MUST use app_ext "1.1" (TV-59 old receivers drop). */
export const MESSAGE_TYPES_1_1 = new Set([
  MessageType.CHALLENGE_REQUEST,
  MessageType.CHALLENGE_RESPONSE,
  MessageType.HOLD_REQUEST,
  MessageType.HOLD_RESPONSE,
  MessageType.CONSENT_PROMPT,
  MessageType.CONSENT_RESPONSE,
  MessageType.DELEGATE_OPEN,
  MessageType.EVENT_PUSH,
  MessageType.SESSION_EPOCH,
  MessageType.RESUME_STORE,
]);

const KNOWN = new Set(Object.values(MessageType));

/**
 * @param {string} type
 * @param {object} [payload]
 * @param {string|null} [requestId]
 * @param {number|null} [tabId]
 */
export function createMessage(type, payload = {}, requestId = null, tabId = null) {
  if (!KNOWN.has(type)) {
    throw new Error(`Unknown message type: ${type}`);
  }
  return {
    app_ext: MESSAGE_TYPES_1_1.has(type) ? APP_EXT_V11 : APP_EXT,
    type,
    request_id: requestId ?? cryptoRandomId(),
    tab_id: tabId ?? null,
    payload: payload ?? {},
  };
}

/**
 * True only for closed-catalog envelopes. Unknown types → false (drop, TV-59).
 * Accepts app_ext 1.0 or 1.1.
 */
export function isAppExtMessage(msg) {
  return (
    msg &&
    typeof msg === 'object' &&
    (msg.app_ext === APP_EXT || msg.app_ext === APP_EXT_V11) &&
    typeof msg.type === 'string' &&
    KNOWN.has(msg.type)
  );
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Request/response helper over chrome.runtime.sendMessage.
 */
export function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Post to a window/iframe with origin check deferred to receiver.
 */
export function postTo(target, msg, targetOrigin = '*') {
  target.postMessage(msg, targetOrigin);
}
