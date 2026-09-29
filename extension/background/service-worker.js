/**
 * Service worker - settings, Mode B confirmation, challenge/hold coordination,
 * webNavigation, DNR, first-party actions (§14 / §24).
 *
 * SSE / EventSource lives in the content script only (SW eviction).
 * Resume tokens: in-memory only (RESUME_STORE); never chrome.storage.
 *
 * First-party action POST path (fallback shell / §10.2.1 / §14 item 2):
 *   view.html MUST NOT fetch() actions (chrome-extension Origin → 403 csrf).
 *   Instead it sends INVOKE_ACTION here; we POST with:
 *     - X-APP-Origin: <page origin>   (never chrome-extension://)
 *     - Authorization: Bearer app-ext:<per-origin token>
 *     - credentials: 'include' (host cookies when host_permissions allow)
 *   Chromium SW fetch would still attach Origin: chrome-extension://…, so a
 *   high-priority dynamic DNR rule (id 900001) REMOVES Origin on extension-
 *   initiated xmlhttprequest/other requests (initiatorDomains = extension id).
 *   Server then takes the Origin-absent + X-APP-Origin + non-cookie auth path.
 */

import { createMessage, MessageType, isAppExtMessage } from '../protocol/messages.js';
import {
  uuidModeToken,
  EXT_VERSION,
  HEADER,
  MEDIA_ACTION,
  MEDIA_DIFF,
  MEDIA_ERROR,
  MEDIA_PAGE,
} from '../protocol/parse.js';
import { staleWindowMs } from '../protocol/validate.js';

const APP_MEDIA = 'application/vnd.agent-page+json';
const ORIGIN_STRIP_RULE_ID = 900001;
const NATIVE_HANDOFF_MS = 300;

const DEFAULT_SETTINGS = {
  renderAppPages: true,
  acceptRewriteOrigins: {},
  reducedMotion: false,
  themeOverride: null,
  alwaysAskConfirm: false,
  debug: false,
};

/** @type {Map<string, { token: string, action: string, createdAt: number, ttlMs?: number }>} */
const pendingConfirmations = new Map();

/** @type {Map<string, { id: string, createdAt: number, ttlMs: number, origin: string, action?: string }>} */
const pendingChallenges = new Map();

/** @type {Map<string, { id: string, createdAt: number, ttlMs: number, origin: string }>} */
const pendingHolds = new Map();

/** Resume tokens - memory only; lost on SW death (§24.2). Keyed by origin. */
/** @type {Map<string, { token: string, storedAt: number, ttlSec: number }>} */
const resumeByOrigin = new Map();

/** Session epoch per origin (memory). */
/** @type {Map<string, number>} */
const sessionEpochByOrigin = new Map();

/** Tabs where we are waiting to see if the content script takes over (§14 preferred). */
/** @type {Map<number, { url: string, timer: ReturnType<typeof setTimeout>, decided: boolean }>} */
const pendingAppNavs = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  if (existing.renderAppPages === undefined) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
  await ensureOriginStripRule();
  await refreshAcceptRewriteRules();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureOriginStripRule();
  void refreshAcceptRewriteRules();
});

// Re-assert Origin-strip on SW wake (dynamic rules persist, but reinstall is cheap).
void ensureOriginStripRule();

/**
 * Prefer same-origin content-script render for native APP docs (§14 item 1).
 * Fall back to view.html only when the content script cannot take over.
 */
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url || details.url.startsWith('chrome-extension://')) return;
  if (!/^https?:/.test(details.url)) return;

  const settings = await getSettings();
  if (settings.renderAppPages === false) return;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      func: () => ({
        contentType: document.contentType || '',
        hasDocumentElement: !!document.documentElement,
      }),
      world: 'MAIN',
    });
    const info = results?.[0]?.result || {};
    const ct = info.contentType || '';
    if (!(ct.includes('vnd.agent-page+json') || ct === APP_MEDIA)) {
      return;
    }

    // Cancel any prior pending handoff for this tab
    clearPendingNav(details.tabId);

    const entry = {
      url: details.url,
      decided: false,
      timer: setTimeout(() => {
        void fallbackToViewHtml(details.tabId, details.url);
      }, NATIVE_HANDOFF_MS),
    };
    pendingAppNavs.set(details.tabId, entry);

    const taken = await tryContentScriptHandoff(details.tabId);
    if (taken) {
      settlePendingNav(details.tabId, true);
      return;
    }
    // Timer will redirect if DETECT_RESULT / later PING does not claim the tab
  } catch {
    // Restricted page or scripting failed - try view.html fallback directly
    try {
      await redirectToViewHtml(details.tabId, details.url);
    } catch {
      /* ignore */
    }
  }
});

/**
 * Message catalog handler (§14 / §24). Unknown types ignored (TV-59).
 * Stale challenge/hold/confirm dropped at min(ttl, 30s).
 * INVOKE_ACTION from extension pages → first-party network POST.
 * No SSE in the service worker.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isAppExtMessage(msg)) {
    return false;
  }

  (async () => {
    switch (msg.type) {
      case MessageType.DETECT_RESULT: {
        const tabId = sender.tab?.id;
        const mode = msg.payload?.mode;
        if (tabId != null && pendingAppNavs.has(tabId) && (mode === 'native' || mode === 'link')) {
          settlePendingNav(tabId, true);
        }
        if ((await getSettings()).debug) {
          console.debug('[APP]', msg.payload);
        }
        sendResponse({ ok: true });
        break;
      }

      case MessageType.INVOKE_ACTION: {
        if (!isExtensionPageSender(sender)) {
          // Content-script path handles actions locally (same-origin Origin).
          sendResponse({ ok: false, ignored: true, reason: 'not_extension_page' });
          break;
        }
        const result = await firstPartyInvokeAction(msg);
        sendResponse(result);
        break;
      }

      case MessageType.CONFIRM_REQUEST: {
        // Mode B - uuid-mode for renderer/extension same-origin sessions only.
        // NEVER mint Mode B for agent clients (§10.4.2).
        const clientKind = msg.payload?.client_kind || 'extension';
        if (String(clientKind).startsWith('agent')) {
          sendResponse(
            createMessage(
              MessageType.CONFIRM_RESPONSE,
              {
                approved: false,
                reason: 'Mode B uuid-mode forbidden for agent clients',
              },
              msg.request_id,
              msg.tab_id ?? sender.tab?.id ?? null,
            ),
          );
          break;
        }

        const raw = crypto.randomUUID();
        const token = uuidModeToken(raw);
        const ttlMs = staleWindowMs(msg.payload?.ttl_ms);
        pendingConfirmations.set(token, {
          token,
          action: msg.payload.action,
          createdAt: Date.now(),
          ttlMs,
          level: msg.payload.level,
          preview: msg.payload.preview,
        });
        sendResponse(
          createMessage(
            MessageType.CONFIRM_RESPONSE,
            { approved: true, token },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.CONFIRM_RESPONSE: {
        const entry = pendingConfirmations.get(msg.payload?.token);
        const windowMs = staleWindowMs(entry?.ttlMs);
        if (entry && Date.now() - entry.createdAt > windowMs) {
          pendingConfirmations.delete(msg.payload.token);
          sendResponse({ ok: false, dropped: 'stale' });
          break;
        }
        sendResponse({ ok: true });
        break;
      }

      case MessageType.CHALLENGE_REQUEST: {
        const challenge = msg.payload?.challenge || msg.payload;
        const id = challenge?.id || crypto.randomUUID();
        const ttlMs = staleWindowMs(challenge?.ttl_ms);
        if (isStaleEntry(pendingChallenges.get(id))) {
          pendingChallenges.delete(id);
        }
        pendingChallenges.set(id, {
          id,
          createdAt: Date.now(),
          ttlMs,
          origin: msg.payload?.origin || '',
          action: msg.payload?.action,
        });
        // Coordination ack; UI lives in renderer (challenge-modal).
        // Pass through for tab broadcast if needed.
        sendResponse(
          createMessage(
            MessageType.CHALLENGE_RESPONSE,
            { pending: true, id, stale_ms: ttlMs },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.CHALLENGE_RESPONSE: {
        const id = msg.payload?.id || msg.payload?.challenge_id;
        const entry = id ? pendingChallenges.get(id) : null;
        if (entry && isStaleEntry(entry)) {
          pendingChallenges.delete(id);
          sendResponse(
            createMessage(
              MessageType.CHALLENGE_RESPONSE,
              { abort: true, reason: 'stale' },
              msg.request_id,
              msg.tab_id ?? sender.tab?.id ?? null,
            ),
          );
          break;
        }
        if (id) pendingChallenges.delete(id);
        sendResponse(
          createMessage(
            MessageType.CHALLENGE_RESPONSE,
            {
              otp: msg.payload?.otp,
              credential: msg.payload?.credential,
              abort: msg.payload?.abort === true,
            },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.HOLD_REQUEST: {
        const hold = msg.payload?.hold || msg.payload;
        const id = hold?.id || crypto.randomUUID();
        const ttlMs = staleWindowMs(hold?.ttl_ms);
        if (isStaleEntry(pendingHolds.get(id))) {
          pendingHolds.delete(id);
        }
        pendingHolds.set(id, {
          id,
          createdAt: Date.now(),
          ttlMs,
          origin: msg.payload?.origin || '',
        });
        sendResponse(
          createMessage(
            MessageType.HOLD_RESPONSE,
            { pending: true, id, stale_ms: ttlMs },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.HOLD_RESPONSE: {
        const id = msg.payload?.id || msg.payload?.hold_id;
        const entry = id ? pendingHolds.get(id) : null;
        if (entry && isStaleEntry(entry)) {
          pendingHolds.delete(id);
          sendResponse(
            createMessage(
              MessageType.HOLD_RESPONSE,
              { abort: true, reason: 'stale' },
              msg.request_id,
              msg.tab_id ?? sender.tab?.id ?? null,
            ),
          );
          break;
        }
        if (id) pendingHolds.delete(id);
        sendResponse(
          createMessage(
            MessageType.HOLD_RESPONSE,
            {
              cleared: msg.payload?.cleared === true,
              abort: msg.payload?.abort === true,
            },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.CONSENT_PROMPT: {
        sendResponse(
          createMessage(
            MessageType.CONSENT_RESPONSE,
            {
              purposes: msg.payload?.purposes || [],
              pending: true,
            },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.CONSENT_RESPONSE: {
        sendResponse(
          createMessage(
            MessageType.CONSENT_RESPONSE,
            {
              purposes: msg.payload?.purposes || [],
              abort: msg.payload?.abort === true,
            },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.DELEGATE_OPEN: {
        const url = msg.payload?.url;
        const tabId = msg.tab_id ?? sender.tab?.id ?? null;
        if (url && typeof url === 'string') {
          try {
            await chrome.tabs.create({ url, active: true });
            sendResponse(
              createMessage(
                MessageType.DELEGATE_OPEN,
                { opened: true, url, origin: msg.payload?.origin },
                msg.request_id,
                tabId,
              ),
            );
          } catch (e) {
            sendResponse(
              createMessage(
                MessageType.DELEGATE_OPEN,
                { opened: false, error: String(e) },
                msg.request_id,
                tabId,
              ),
            );
          }
        } else {
          sendResponse(
            createMessage(
              MessageType.DELEGATE_OPEN,
              { opened: false, error: 'missing url' },
              msg.request_id,
              tabId,
            ),
          );
        }
        break;
      }

      case MessageType.RESUME_STORE: {
        // Memory only - never chrome.storage (§24.1 / §13).
        const origin = msg.payload?.origin;
        const token = msg.payload?.token;
        const clear = msg.payload?.clear === true;
        if (!origin || typeof origin !== 'string') {
          sendResponse({ ok: false, error: 'origin required' });
          break;
        }
        if (clear || token === '' || token == null) {
          resumeByOrigin.delete(origin);
          sendResponse(
            createMessage(
              MessageType.RESUME_STORE,
              { ok: true, cleared: true, origin },
              msg.request_id,
              msg.tab_id ?? sender.tab?.id ?? null,
            ),
          );
          break;
        }
        if (typeof token !== 'string') {
          sendResponse({ ok: false, error: 'token required' });
          break;
        }
        const ttlSec = Math.min(2_592_000, Math.max(1, Number(msg.payload?.ttl) || 86_400));
        resumeByOrigin.set(origin, {
          token,
          storedAt: Date.now(),
          ttlSec,
        });
        sendResponse(
          createMessage(
            MessageType.RESUME_STORE,
            { ok: true, origin, stored: true },
            msg.request_id,
            msg.tab_id ?? sender.tab?.id ?? null,
          ),
        );
        break;
      }

      case MessageType.SESSION_EPOCH: {
        const origin = msg.payload?.origin;
        const epoch = Number(msg.payload?.epoch);
        if (origin && Number.isFinite(epoch)) {
          sessionEpochByOrigin.set(origin, epoch);
        }
        // Fan-out to tabs for cache purge
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id == null) continue;
          try {
            await chrome.tabs.sendMessage(tab.id, msg);
          } catch {
            /* no content script */
          }
        }
        sendResponse({ ok: true });
        break;
      }

      case MessageType.SETTINGS_UPDATE: {
        if (msg.payload?.acceptRewriteOrigins) {
          await chrome.storage.sync.set({
            acceptRewriteOrigins: msg.payload.acceptRewriteOrigins,
          });
          await refreshAcceptRewriteRules();
        }
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id == null) continue;
          try {
            await chrome.tabs.sendMessage(tab.id, msg);
          } catch {
            /* no content script */
          }
        }
        sendResponse({ ok: true });
        break;
      }

      case MessageType.PING:
        sendResponse(
          createMessage(MessageType.PONG, {}, msg.request_id, msg.tab_id ?? sender.tab?.id ?? null),
        );
        break;

      case MessageType.PONG:
        sendResponse({ ok: true });
        break;

      case MessageType.EVENT_PUSH:
        // Events are owned by content script; SW does not subscribe.
        sendResponse({ ok: false, ignored: true, reason: 'no_sse_in_sw' });
        break;

      default:
        // Unknown types ignored per §14 / TV-59
        sendResponse({ ok: false, ignored: true });
        break;
    }
  })().catch((err) => {
    sendResponse({
      app_ext: '1.0',
      type: MessageType.MANIFEST_ERROR,
      request_id: msg.request_id,
      tab_id: msg.tab_id ?? null,
      payload: {
        error: {
          app: '1.0',
          error: { code: 'app.err.internal', message: String(err), retryable: false },
        },
      },
    });
  });

  return true; // async
});

function isStaleEntry(entry) {
  if (!entry) return false;
  const windowMs = staleWindowMs(entry.ttlMs);
  return Date.now() - entry.createdAt > windowMs;
}

/** Read resume token from memory (not storage). */
function getResumeToken(origin) {
  const entry = resumeByOrigin.get(origin);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > entry.ttlSec * 1000) {
    resumeByOrigin.delete(origin);
    return null;
  }
  return entry.token;
}
void getResumeToken;

function isExtensionPageSender(sender) {
  const url = sender?.url || '';
  return url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

/**
 * Ping the tab content script. If it reports native/link mode, prefer in-page render.
 */
async function tryContentScriptHandoff(tabId) {
  try {
    const ping = createMessage(MessageType.PING, {});
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, ping),
      delay(NATIVE_HANDOFF_MS).then(() => null),
    ]);
    if (!response) return false;
    const mode = response.payload?.mode;
    if (mode === 'native' || mode === 'link') return true;
    return response.payload?.will_render === true;
  } catch {
    return false;
  }
}

function settlePendingNav(tabId, keepInPlace) {
  const entry = pendingAppNavs.get(tabId);
  if (!entry || entry.decided) return;
  entry.decided = true;
  clearTimeout(entry.timer);
  pendingAppNavs.delete(tabId);
  if (!keepInPlace) {
    void redirectToViewHtml(tabId, entry.url);
  }
}

function clearPendingNav(tabId) {
  const entry = pendingAppNavs.get(tabId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingAppNavs.delete(tabId);
}

async function fallbackToViewHtml(tabId, _url) {
  const entry = pendingAppNavs.get(tabId);
  if (!entry || entry.decided) return;
  // Last-chance ping before redirecting to the extension shell
  const taken = await tryContentScriptHandoff(tabId);
  settlePendingNav(tabId, taken);
}

async function redirectToViewHtml(tabId, url) {
  const view = chrome.runtime.getURL(`renderer/view.html?url=${encodeURIComponent(url)}`);
  await chrome.tabs.update(tabId, { url: view });
}

/**
 * First-party action POST for view.html (§10.2.1 / §14 fallback).
 * Expects payload fields prepared by the renderer (exact body bytes).
 */
async function firstPartyInvokeAction(msg) {
  const p = msg.payload || {};
  const actionUrl = p.action_url;
  const pageOrigin = p.page_origin;
  const bodyText = p.body_text;

  if (!actionUrl || !pageOrigin || typeof bodyText !== 'string') {
    return createMessage(
      MessageType.ACTION_RESULT,
      {
        mode: 'error',
        document: {
          app: '1.0',
          error: {
            code: 'app.err.payload.invalid',
            message: 'INVOKE_ACTION missing action_url, page_origin, or body_text',
            retryable: false,
          },
        },
      },
      msg.request_id,
      msg.tab_id ?? null,
    );
  }

  let actionOrigin;
  try {
    actionOrigin = new URL(actionUrl).origin;
  } catch {
    return createMessage(
      MessageType.ACTION_RESULT,
      {
        mode: 'error',
        document: {
          app: '1.0',
          error: {
            code: 'app.err.navigation.invalid_url',
            message: 'Invalid action_url',
            retryable: false,
          },
        },
      },
      msg.request_id,
      msg.tab_id ?? null,
    );
  }

  if (actionOrigin !== pageOrigin) {
    return createMessage(
      MessageType.ACTION_RESULT,
      {
        mode: 'error',
        document: {
          app: '1.0',
          error: {
            code: 'app.err.security.cross_origin',
            message: `Rejected cross-origin action POST to ${actionOrigin}`,
            retryable: false,
          },
        },
      },
      msg.request_id,
      msg.tab_id ?? null,
    );
  }

  // Ensure DNR Origin-strip is installed before this fetch.
  await ensureOriginStripRule();

  const bearer = await getFirstPartyBearer(pageOrigin);
  const headers = {
    Accept: `${MEDIA_DIFF}, ${MEDIA_PAGE}, ${MEDIA_ERROR}`,
    'Content-Type': MEDIA_ACTION,
    [HEADER.CLIENT]: `extension/${EXT_VERSION}`,
    [HEADER.ACCEPT_VERSIONS]: '1.0, 1.1',
    [HEADER.ORIGIN]: pageOrigin,
    Authorization: bearer,
  };
  if (p.idempotency_key) {
    headers[HEADER.IDEMPOTENCY_KEY] = p.idempotency_key;
  }
  if (p.if_match_version) {
    headers[HEADER.IF_MATCH_VERSION] = p.if_match_version;
  }
  if (p.confirmation_token) {
    headers[HEADER.CONFIRMATION] = p.confirmation_token;
  }
  if (p.challenge_id) {
    headers[HEADER.CHALLENGE] = p.challenge_id;
  }
  if (p.hold_token) {
    headers[HEADER.HOLD_TOKEN] = p.hold_token;
  }
  if (p.resume_token) {
    headers[HEADER.RESUME] = p.resume_token;
  } else {
    const mem = resumeByOrigin.get(pageOrigin);
    if (mem && Date.now() - mem.storedAt <= mem.ttlSec * 1000) {
      headers[HEADER.RESUME] = mem.token;
    }
  }

  try {
    const res = await fetch(actionUrl, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: bodyText,
      // 'manual' surfaces 303s as opaqueredirect (status 0, headers stripped)
      // even in SW fetches — Form C navigations were unreachable. 'follow'
      // GETs the target page; res.redirected + res.url carry the target (§3.4).
      redirect: 'follow',
    });

    const result = await serializeActionResponse(res, p, pageOrigin);
    return createMessage(MessageType.ACTION_RESULT, result, msg.request_id, msg.tab_id ?? null);
  } catch (e) {
    return createMessage(
      MessageType.ACTION_RESULT,
      {
        mode: 'error',
        document: {
          app: '1.0',
          error: {
            code: 'app.err.transport.network',
            message: e instanceof Error ? e.message : String(e),
            retryable: true,
          },
        },
      },
      msg.request_id,
      msg.tab_id ?? null,
    );
  }
}

/**
 * Mirror content-script / view.js action response shaping for the renderer.
 */
async function serializeActionResponse(res, payload, _pageOrigin) {
  const actionId = payload.action;

  if (res.redirected && res.url) {
    // Form C - Redirect (§3.4): fetch followed the 303; res.url is the target.
    return {
      mode: 'redirect',
      url: res.url,
      status: res.status,
      result_version: res.headers.get(HEADER.RESULT_VERSION),
      headers: headerMap(res),
    };
  }

  const text = await res.text();
  let doc = null;
  if (text) {
    try {
      doc = JSON.parse(text);
    } catch (e) {
      return {
        mode: 'error',
        status: res.status,
        document: {
          app: '1.0',
          error: {
            code: 'app.err.payload.invalid_json',
            message: e instanceof Error ? e.message : String(e),
            retryable: true,
          },
        },
      };
    }
  }
  if (doc && typeof doc === 'object' && 'page_version' in doc) {
    delete doc.page_version;
  }

  let mode = (res.headers.get(HEADER.RESPONSE_MODE) || '').toLowerCase();
  if (!mode || !['full', 'diff', 'redirect', 'error', 'async'].includes(mode)) {
    if (res.status === 202) mode = 'async';
    else if (doc?.diff && doc?.base) mode = 'diff';
    else if (doc?.error?.code && !doc?.page) mode = 'error';
    else mode = 'full';
  }

  const resultVersion =
    res.headers.get(HEADER.RESULT_VERSION) || doc?.result_version || doc?.page?.version || null;

  if (mode === 'async' || res.status === 202) {
    const statusUrl =
      doc?.state?.operation_status?.value?.status_url?.value ||
      doc?.state?.operation_status?.value?.status_url ||
      null;
    return {
      mode: 'async',
      document: doc,
      status: 202,
      action: actionId,
      params: payload.params,
      result_version: resultVersion,
      status_url: statusUrl,
      poll_interval_ms: Math.max(500, Number(doc?.meta?.poll_interval_ms) || 2000),
      headers: headerMap(res),
      body_bytes_held: true,
    };
  }

  return {
    mode,
    document: doc,
    status: res.status,
    headers: headerMap(res),
    action: actionId,
    params: payload.params,
    result_version: resultVersion,
    body_bytes_held: true,
  };
}

function headerMap(res) {
  const out = {};
  try {
    for (const [k, v] of res.headers.entries()) out[k] = v;
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Stable per-origin bearer for the X-APP-Origin CSRF path (§10.2 rule 2).
 * Presence satisfies non-cookie auth; action-level auth:none still applies.
 */
async function getFirstPartyBearer(origin) {
  const stored = await chrome.storage.local.get('firstPartyTokens');
  /** @type {Record<string, string>} */
  const tokens = stored.firstPartyTokens || {};
  if (!tokens[origin]) {
    tokens[origin] = crypto.randomUUID();
    await chrome.storage.local.set({ firstPartyTokens: tokens });
  }
  return `Bearer app-ext:${tokens[origin]}`;
}

/**
 * Strip Origin from extension-initiated requests so X-APP-Origin is authoritative.
 * Uses a reserved dynamic rule id so Accept-rewrite refresh does not wipe it.
 */
async function ensureOriginStripRule() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;

  const rule = {
    id: ORIGIN_STRIP_RULE_ID,
    priority: 100,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Origin', operation: 'remove' }],
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ['xmlhttprequest', 'other'],
    },
  };

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ORIGIN_STRIP_RULE_ID],
      addRules: [rule],
    });
  } catch (err) {
    console.warn('[APP] Failed to install Origin-strip DNR rule', err);
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Optional DNR Accept rewriting for opted-in origins (§14).
 * Uses dynamic rules (ids 1..N); Origin-strip uses reserved id 900001.
 */
async function refreshAcceptRewriteRules() {
  if (!chrome.declarativeNetRequest) return;

  const settings = await getSettings();
  const origins = Object.keys(settings.acceptRewriteOrigins || {}).filter(
    (o) => settings.acceptRewriteOrigins[o],
  );

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  // Preserve the Origin-strip rule (id 900001).
  const removeRuleIds = existing.map((r) => r.id).filter((id) => id !== ORIGIN_STRIP_RULE_ID);

  const addRules = origins.map((origin, i) => {
    let urlFilter;
    try {
      const u = new URL(origin);
      urlFilter = `|${u.origin}/*`;
    } catch {
      urlFilter = `|${origin}/*`;
    }
    return {
      id: i + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            header: 'Accept',
            operation: 'set',
            value:
              'application/vnd.agent-page+json, application/vnd.agent-page-diff+json, application/vnd.agent-page-error+json, text/html;q=0.8,*/*;q=0.1',
          },
        ],
      },
      condition: {
        urlFilter,
        resourceTypes: ['main_frame'],
      },
    };
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });

  // Accept-rewrite refresh may race with install; re-assert Origin strip.
  await ensureOriginStripRule();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep pending maps tidy; UX stale window is min(ttl, 30s)
setInterval(() => {
  for (const [k, v] of pendingConfirmations) {
    if (isStaleEntry(v) || Date.now() - v.createdAt > 300_000) {
      pendingConfirmations.delete(k);
    }
  }
  for (const [k, v] of pendingChallenges) {
    if (isStaleEntry(v)) pendingChallenges.delete(k);
  }
  for (const [k, v] of pendingHolds) {
    if (isStaleEntry(v)) pendingHolds.delete(k);
  }
  for (const [origin, entry] of resumeByOrigin) {
    if (Date.now() - entry.storedAt > entry.ttlSec * 1000) {
      resumeByOrigin.delete(origin);
    }
  }
}, 60_000);
