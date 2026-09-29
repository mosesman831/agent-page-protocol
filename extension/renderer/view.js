/**
 * Extension page viewer for APP Content-Type navigations (§14 fallback shell).
 * Loaded as chrome-extension://…/renderer/view.html?url=…
 *
 * Action POSTs MUST go through the service worker (INVOKE_ACTION relay) so the
 * request never carries Origin: chrome-extension://… (§10.2.1 / §14 item 2).
 * Manifest GETs may stay as direct fetch from this page (not CSRF-sensitive).
 */

import { AppRenderer } from './render-root.js';
import {
  ACCEPT_HEADER,
  APP_VERSION,
  EXT_VERSION,
  HEADER,
  parseJsonText,
  readResultVersion,
  stripNonAuthoritativeRoot,
  uuid,
} from '../protocol/parse.js';
import { validateAppDocument } from '../protocol/validate.js';
import { createMessage, MessageType, isAppExtMessage, sendMessage } from '../protocol/messages.js';

const params = new URLSearchParams(location.search);
const targetUrl = params.get('url');

const root = document.getElementById('root');

/** Last action POST body bytes for Mode A challenge-echo (§10.4.2). */
let lastActionPost = null;

if (!targetUrl) {
  root.innerHTML = `<div class="app-error" role="alert"><h1>Missing url</h1><p>Open via webNavigation redirect with ?url=</p></div>`;
} else {
  boot(targetUrl).catch((err) => {
    root.innerHTML = `<div class="app-error" role="alert"><h1>Failed</h1><p>${escapeHtml(err.message)}</p></div>`;
  });
}

async function boot(url) {
  let pageOrigin;
  try {
    pageOrigin = new URL(url).origin;
  } catch {
    throw new Error('Invalid url parameter');
  }

  const settings = await chrome.storage.sync.get(null);

  /** @type {object|null} */
  let manifest = null;

  const renderer = new AppRenderer({
    root: document,
    origin: pageOrigin,
    url,
    settings,
    send: async (msg) => handleBridgeMessage(msg),
  });
  renderer.mount();

  async function handleBridgeMessage(msg) {
    if (!isAppExtMessage(msg)) return null;

    switch (msg.type) {
      case MessageType.FETCH_MANIFEST: {
        try {
          const doc = await fetchManifest(msg.payload.url || url, pageOrigin, manifest);
          manifest = doc;
          const ready = createMessage(
            MessageType.MANIFEST_READY,
            {
              manifest: doc,
              version: doc?.page?.version ?? null,
              result_version: doc?.page?.version ?? null,
            },
            msg.request_id,
          );
          renderer.setManifest(doc, doc?.page?.version ?? null);
          return ready;
        } catch (e) {
          const err = createMessage(
            MessageType.MANIFEST_ERROR,
            {
              error: {
                app: APP_VERSION,
                error: {
                  code: 'app.err.transport.network',
                  message: e.message,
                  retryable: true,
                },
              },
            },
            msg.request_id,
          );
          renderer.showError(err.payload.error);
          return err;
        }
      }
      case MessageType.INVOKE_ACTION: {
        const result = await invokeAction(url, pageOrigin, manifest, msg.payload);
        if ((result.mode === 'full' || result.mode === 'async') && result.document?.page) {
          manifest = result.document;
        }
        return createMessage(MessageType.ACTION_RESULT, result, msg.request_id);
      }
      case MessageType.NAVIGATE: {
        const next = msg.payload.url;
        if (!sameOrigin(next, pageOrigin)) {
          throw new Error('Cross-origin navigation rejected');
        }
        const view = chrome.runtime.getURL(`renderer/view.html?url=${encodeURIComponent(next)}`);
        if (msg.payload.mode === 'replace') {
          location.replace(view);
        } else {
          location.assign(view);
        }
        return createMessage(MessageType.PONG, {}, msg.request_id);
      }
      case MessageType.CONFIRM_REQUEST:
      case MessageType.CHALLENGE_REQUEST:
      case MessageType.CHALLENGE_RESPONSE:
      case MessageType.HOLD_REQUEST:
      case MessageType.HOLD_RESPONSE:
      case MessageType.CONSENT_PROMPT:
      case MessageType.CONSENT_RESPONSE:
      case MessageType.RESUME_STORE:
      case MessageType.SESSION_EPOCH:
      case MessageType.DELEGATE_OPEN:
        return sendMessage(msg);
      case MessageType.PING:
        return createMessage(MessageType.PONG, {}, msg.request_id);
      default:
        return null;
    }
  }

  await handleBridgeMessage(createMessage(MessageType.FETCH_MANIFEST, { url }));

  chrome.runtime.onMessage.addListener((msg) => {
    if (isAppExtMessage(msg) && msg.type === MessageType.SETTINGS_UPDATE) {
      renderer.applySettings(msg.payload);
    }
  });
}

async function fetchManifest(url, pageOrigin, current) {
  assertSameOrigin(url, pageOrigin);
  const headers = {
    Accept: ACCEPT_HEADER,
    [HEADER.CLIENT]: `extension/${EXT_VERSION}`,
    [HEADER.ACCEPT_VERSIONS]: '1.0, 1.1',
  };
  if (current?.page?.version) {
    headers[HEADER.IF_MATCH_VERSION] = current.page.version;
  }
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
    redirect: 'follow',
  });
  return parseResponse(res);
}

async function invokeAction(pageUrl, pageOrigin, manifest, payload) {
  const actionId = payload.action;
  const actionDef = manifest?.actions?.[actionId];
  const actionUrl = actionDef?.action_url || pageUrl;
  assertSameOrigin(actionUrl, pageOrigin);

  let bodyText;
  let idempotencyKey;
  if (payload.reuse_body && lastActionPost && lastActionPost.actionId === actionId) {
    bodyText = lastActionPost.bodyText;
    idempotencyKey = lastActionPost.idempotencyKey;
  } else {
    idempotencyKey = `idem_${uuid().replace(/-/g, '').slice(0, 24)}`;
    const body = {
      app: APP_VERSION,
      action: actionId,
      params: payload.params || {},
      client: { kind: 'extension', name: 'app-renderer', version: EXT_VERSION },
      context: {
        page_id: manifest?.page?.id,
        page_url: manifest?.page?.url || pageUrl,
        manifest_version: manifest?.page?.version,
      },
    };
    bodyText = JSON.stringify(body);
    lastActionPost = { bodyText, actionId, idempotencyKey };
  }

  // First-party relay via SW (§14 item 2 / §10.2.1): never fetch() from
  // chrome-extension:// - that Origin is rejected as csrf. SW POSTs with
  // X-APP-Origin + Bearer and DNR-stripped Origin.
  const relay = await sendMessage(
    createMessage(MessageType.INVOKE_ACTION, {
      action: actionId,
      params: payload.params || {},
      confirmation_token: payload.confirmation_token,
      challenge_id: payload.challenge_id,
      hold_token: payload.hold_token,
      resume_token: payload.resume_token,
      action_url: actionUrl,
      page_origin: pageOrigin,
      page_url: pageUrl,
      body_text: bodyText,
      idempotency_key: idempotencyKey,
      if_match_version: manifest?.page?.version || null,
    }),
  );

  if (!isAppExtMessage(relay) || relay.type !== MessageType.ACTION_RESULT) {
    return {
      mode: 'error',
      document: {
        app: APP_VERSION,
        error: {
          code: 'app.err.transport.network',
          message: relay?.payload?.error?.error?.message || 'First-party action relay failed',
          retryable: true,
        },
      },
    };
  }

  return relay.payload;
}

async function parseResponse(res) {
  const doc = await parseResponseBody(res);
  if (!res.ok) {
    const err = new Error(doc?.error?.message || `HTTP ${res.status}`);
    err.document = doc;
    err.status = res.status;
    throw err;
  }
  const resultVersion = readResultVersion(res.headers);
  const v = validateAppDocument(doc);
  if (!v.ok || v.kind !== 'manifest') {
    throw new Error(v.message || 'Expected Page Manifest');
  }
  if (resultVersion && v.manifest?.page) {
    v.manifest.page.version = resultVersion;
  }
  return v.manifest;
}

async function parseResponseBody(res) {
  const text = await res.text();
  if (!text) return null;
  const parsed = parseJsonText(text);
  if (!parsed.ok) return parsed.error;
  return stripNonAuthoritativeRoot(parsed.value);
}

function assertSameOrigin(url, pageOrigin) {
  if (new URL(url).origin !== pageOrigin) {
    throw new Error(`Same-origin reject: ${url}`);
  }
}

function sameOrigin(url, pageOrigin) {
  try {
    return new URL(url, pageOrigin).origin === pageOrigin;
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
