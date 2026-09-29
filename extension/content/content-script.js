/**
 * Content script - detection pipeline §14, fetch bridge, 303/202/confirm (§3.4, §6.9, §10.4).
 * §24: events owner (EventSource); challenge/hold/consent/delegate bridge.
 * Classic script (no static imports); dynamically loads injector + events modules.
 */

(() => {
  'use strict';

  const APP_MEDIA = 'application/vnd.agent-page+json';
  const APP_EXT = '1.0';
  const APP_EXT_V11 = '1.1';
  const EXT_VERSION = '0.5.0';
  const HEADER = {
    CLIENT: 'X-APP-Client',
    IF_MATCH_VERSION: 'X-APP-If-Match-Version',
    IDEMPOTENCY_KEY: 'X-APP-Idempotency-Key',
    CONFIRMATION: 'X-APP-Confirmation',
    RESPONSE_MODE: 'X-APP-Response-Mode',
    RESULT_VERSION: 'X-APP-Result-Version',
    NAVIGATE: 'X-APP-Navigate',
    CHALLENGE: 'X-APP-Challenge',
    HOLD_TOKEN: 'X-APP-Hold-Token',
    RESUME: 'X-APP-Resume',
    ACCEPT_VERSIONS: 'X-APP-Accept-Versions',
  };

  const TYPES_1_1 = new Set([
    'CHALLENGE_REQUEST',
    'CHALLENGE_RESPONSE',
    'HOLD_REQUEST',
    'HOLD_RESPONSE',
    'CONSENT_PROMPT',
    'CONSENT_RESPONSE',
    'DELEGATE_OPEN',
    'EVENT_PUSH',
    'SESSION_EPOCH',
    'RESUME_STORE',
  ]);

  const KNOWN_TYPES = new Set([
    'DETECT_RESULT',
    'FETCH_MANIFEST',
    'MANIFEST_READY',
    'MANIFEST_ERROR',
    'INVOKE_ACTION',
    'ACTION_RESULT',
    'NAVIGATE',
    'CONFIRM_REQUEST',
    'CONFIRM_RESPONSE',
    'SETTINGS_UPDATE',
    'PING',
    'PONG',
    ...TYPES_1_1,
  ]);

  const pageState = {
    origin: location.origin,
    url: location.href,
    manifest: null,
    version: null,
    pendingAction: null,
    lastError: null,
    history: [],
    mode: 'pass_through',
    /** @type {{ bodyText: string, actionId: string, idempotencyKey: string }|null} */
    lastActionPost: null,
    sessionEpoch: 0,
    eventsUrl: null,
  };

  let rendererApi = null;
  let bootPromise = null;
  /** @type {{ close: () => void }|null} */
  let eventSub = null;

  try {
    if (
      document.contentType === APP_MEDIA ||
      (document.contentType && document.contentType.includes('vnd.agent-page+json'))
    ) {
      pageState.mode = 'native';
    }
  } catch {
    /* contentType may be unavailable */
  }

  notifyDetect();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  function onReady() {
    if (pageState.mode === 'native') {
      void ensureRenderer('native');
      return;
    }

    const link =
      document.querySelector('link[rel="agent-page"]') ||
      document.querySelector('link[rel="alternate"][type="application/vnd.agent-page+json"]');
    const meta = document.querySelector('meta[name="agent-page"]');

    if (link || (meta && meta.getAttribute('content') === 'available')) {
      pageState.mode = 'link';
      const href = link?.href || location.href;
      pageState.url = href;
      notifyDetect();
      void ensureRenderer('link');
      return;
    }

    pageState.mode = 'pass_through';
    notifyDetect();
  }

  function envelopeAppExt(type) {
    return TYPES_1_1.has(type) ? APP_EXT_V11 : APP_EXT;
  }

  function makeMsg(type, payload, requestId, tabId) {
    return {
      app_ext: envelopeAppExt(type),
      type,
      request_id: requestId ?? rid(),
      tab_id: tabId ?? null,
      payload: payload ?? {},
    };
  }

  function isAppExt(msg) {
    return (
      msg &&
      (msg.app_ext === APP_EXT || msg.app_ext === APP_EXT_V11) &&
      typeof msg.type === 'string' &&
      KNOWN_TYPES.has(msg.type)
    );
  }

  function notifyDetect() {
    safeSend(
      makeMsg('DETECT_RESULT', {
        mode: pageState.mode === 'pass_through' ? 'none' : pageState.mode,
        url: pageState.url,
      }),
    );
  }

  async function ensureRenderer(mode) {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      const settings = await chrome.storage.sync.get(null);
      if (settings.renderAppPages === false && mode === 'native') {
        return null;
      }
      const modUrl = chrome.runtime.getURL('content/injector.js');
      const mod = await import(modUrl);
      rendererApi = await mod.injectRenderer({
        mode,
        pageState,
        settings,
        bridge: createBridge(),
      });
      return rendererApi;
    })();
    return bootPromise;
  }

  function createBridge() {
    return {
      async send(msg) {
        return handleRendererMessage(msg);
      },
      getState() {
        return pageState;
      },
    };
  }

  async function handleRendererMessage(msg) {
    if (!isAppExt(msg)) return null;

    switch (msg.type) {
      case 'FETCH_MANIFEST':
        return fetchManifest(msg);
      case 'INVOKE_ACTION':
        return invokeAction(msg);
      case 'NAVIGATE':
        return navigate(msg);
      case 'CONFIRM_REQUEST':
      case 'CHALLENGE_REQUEST':
      case 'CHALLENGE_RESPONSE':
      case 'HOLD_REQUEST':
      case 'HOLD_RESPONSE':
      case 'CONSENT_PROMPT':
      case 'CONSENT_RESPONSE':
      case 'RESUME_STORE':
        return relayToBackground(msg);
      case 'DELEGATE_OPEN':
        return openDelegate(msg);
      case 'SESSION_EPOCH':
        return handleSessionEpoch(msg);
      case 'PING':
        return makeMsg('PONG', {}, msg.request_id, msg.tab_id);
      default:
        return null;
    }
  }

  function relayToBackground(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          if (msg.type === 'CONFIRM_REQUEST') {
            resolve(
              makeMsg(
                'CONFIRM_RESPONSE',
                { approved: true, token: `uuid-mode:${rid()}` },
                msg.request_id,
                msg.tab_id,
              ),
            );
            return;
          }
          resolve(
            makeMsg(
              msg.type.endsWith('_REQUEST') ? msg.type.replace('_REQUEST', '_RESPONSE') : msg.type,
              { abort: true, reason: chrome.runtime.lastError.message },
              msg.request_id,
              msg.tab_id,
            ),
          );
          return;
        }
        resolve(response);
      });
    });
  }

  async function openDelegate(msg) {
    const url = msg.payload?.url;
    if (!url) {
      return makeMsg(
        'DELEGATE_OPEN',
        { opened: false, error: 'missing url' },
        msg.request_id,
        msg.tab_id,
      );
    }
    // Prefer background tab create (user gesture may already be spent).
    const res = await relayToBackground(msg);
    if (res?.payload?.opened) return res;
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return makeMsg(
        'DELEGATE_OPEN',
        { opened: true, url, origin: msg.payload?.origin },
        msg.request_id,
        msg.tab_id,
      );
    } catch (e) {
      return makeMsg(
        'DELEGATE_OPEN',
        { opened: false, error: e.message },
        msg.request_id,
        msg.tab_id,
      );
    }
  }

  function handleSessionEpoch(msg) {
    const epoch = Number(msg.payload?.epoch);
    if (Number.isFinite(epoch) && epoch !== pageState.sessionEpoch) {
      pageState.sessionEpoch = epoch;
      // Drop private in-tab cache on epoch change (§13.3)
      pageState.manifest = null;
      pageState.version = null;
      pageState.lastActionPost = null;
      rendererApi?.renderer?.announce?.('Session changed; reloading…');
    }
    safeSend(msg);
    return makeMsg(
      'SESSION_EPOCH',
      { epoch: pageState.sessionEpoch, ok: true },
      msg.request_id,
      msg.tab_id,
    );
  }

  async function ensureEventSubscription(manifest) {
    const eventsUrl =
      manifest?.meta?.events_url || nodePlain(manifest?.state?.events_url) || pageState.eventsUrl;
    if (!eventsUrl) return;
    let abs;
    try {
      abs = new URL(eventsUrl, pageState.url);
      if (abs.origin !== pageState.origin) return;
    } catch {
      return;
    }
    pageState.eventsUrl = abs.href;
    if (eventSub) {
      // Reopening discards the event cursor — a fresh subscription replays the
      // server's whole log, whose stale diffs trigger revalidate → resubscribe
      // → replay. Reuse the live subscription (reconnects carry Last-Event-ID).
      if (eventSub.eventsUrl === abs.href) return;
      eventSub.close();
      eventSub = null;
    }
    try {
      const modUrl = chrome.runtime.getURL('content/events.js');
      const mod = await import(modUrl);
      eventSub = Object.assign(
        mod.subscribeEvents({
          eventsUrl: abs.href,
          pageUrl: pageState.url,
          origin: pageState.origin,
          onEvent: (doc) => {
            const push = makeMsg('EVENT_PUSH', { event: doc });
            rendererApi?.renderer?.handleEventPush?.(doc);
            // An event-diff bumps manifest.page.version renderer-side; mirror it
            // into pageState or the next action's If-Match-Version is stale (409).
            const evVersion = doc?.event?.diff?.result_version ?? doc?.event?.version;
            if (evVersion) pageState.version = String(evVersion);
            // Also postMessage into shadow host window for view listeners
            try {
              window.postMessage(push, '*');
            } catch {
              /* ignore */
            }
            if (doc?.event?.type === 'session.expired') {
              void handleSessionEpoch(
                makeMsg('SESSION_EPOCH', {
                  epoch: (pageState.sessionEpoch || 0) + 1,
                  origin: pageState.origin,
                }),
              );
            }
          },
          onError: (err) => {
            if (pageState.manifest?.meta?.debug || false) {
              console.debug('[APP events]', err);
            }
          },
        }),
        { eventsUrl: abs.href },
      );
    } catch (e) {
      console.warn('[APP] events subscribe failed', e);
    }
  }

  function nodePlain(node) {
    if (node == null) return null;
    if (typeof node === 'object' && 'value' in node) return node.value;
    return node;
  }

  /** Parse Set-APP-Resume into background memory (never chrome.storage). */
  function captureResumeHeader(res) {
    try {
      const raw = res.headers.get('Set-APP-Resume') || res.headers.get('set-app-resume');
      if (!raw) return;
      const token = raw.split(';')[0]?.trim();
      if (!token) return;
      let ttl = 86400;
      const m = /ttl\s*=\s*(\d+)/i.exec(raw);
      if (m) ttl = Number(m[1]);
      safeSend(
        makeMsg('RESUME_STORE', {
          origin: pageState.origin,
          token,
          ttl,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  async function fetchManifest(msg) {
    const url = msg.payload?.url || pageState.url;
    try {
      assertSameOrigin(url);
      const headers = {
        Accept:
          'application/vnd.agent-page+json, application/vnd.agent-page-diff+json, application/vnd.agent-page-error+json',
        [HEADER.CLIENT]: `extension/${EXT_VERSION}`,
        [HEADER.ACCEPT_VERSIONS]: `${APP_EXT}, ${APP_EXT_V11}`,
      };
      if (pageState.version) {
        headers[HEADER.IF_MATCH_VERSION] = pageState.version;
      }
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
      const text = await res.text();
      let doc;
      try {
        doc = JSON.parse(text);
      } catch (e) {
        return errorMsg(msg, 'app.err.payload.invalid_json', e.message);
      }
      // Ignore non-authoritative root page_version
      if (doc && typeof doc === 'object' && 'page_version' in doc) {
        delete doc.page_version;
      }
      const resultVersion = res.headers.get(HEADER.RESULT_VERSION);
      captureResumeHeader(res);
      if (!res.ok || (doc?.error?.code && !doc?.page)) {
        pageState.lastError = doc;
        return makeMsg(
          'MANIFEST_ERROR',
          { error: doc, status: res.status },
          msg.request_id,
          msg.tab_id,
        );
      }
      pageState.manifest = doc;
      pageState.version = resultVersion || doc.page?.version || pageState.version || null;
      pageState.url = url;
      const epoch = Number(doc?.meta?.session_epoch);
      if (Number.isFinite(epoch)) pageState.sessionEpoch = epoch;
      void ensureEventSubscription(doc);
      return makeMsg(
        'MANIFEST_READY',
        {
          manifest: doc,
          version: pageState.version,
          result_version: resultVersion,
        },
        msg.request_id,
        msg.tab_id,
      );
    } catch (e) {
      return errorMsg(msg, 'app.err.transport.network', e.message);
    }
  }

  async function invokeAction(msg) {
    const actionId = msg.payload.action;
    const params = msg.payload.params || {};
    const token = msg.payload.confirmation_token;
    const reuseBody = msg.payload.reuse_body === true;
    const manifest = pageState.manifest;
    if (!manifest) {
      return actionResult(msg, {
        mode: 'error',
        document: {
          app: '1.0',
          error: {
            code: 'app.err.action.not_found',
            message: 'No manifest',
            retryable: false,
          },
        },
      });
    }

    const actionDef = manifest.actions?.[actionId];
    const actionUrl = actionDef?.action_url || pageState.url;
    try {
      assertSameOrigin(actionUrl);
    } catch (e) {
      return actionResult(msg, {
        mode: 'error',
        document: {
          app: '1.0',
          error: {
            code: 'app.err.security.cross_origin',
            message: e.message,
            retryable: false,
          },
        },
      });
    }

    pageState.pendingAction = { id: actionId, startedAt: Date.now() };

    // Challenge-echo (§10.4.2 Mode A): identical raw body bytes on re-POST
    let bodyText;
    let idempotencyKey;
    if (reuseBody && pageState.lastActionPost && pageState.lastActionPost.actionId === actionId) {
      bodyText = pageState.lastActionPost.bodyText;
      idempotencyKey = pageState.lastActionPost.idempotencyKey;
    } else {
      idempotencyKey = `idem_${rid().replace(/-/g, '').slice(0, 24)}`;
      const body = {
        app: '1.0',
        action: actionId,
        params,
        client: {
          kind: 'extension',
          name: 'app-renderer',
          version: EXT_VERSION,
        },
        context: {
          page_id: manifest.page?.id,
          page_url: manifest.page?.url || pageState.url,
          manifest_version: pageState.version,
        },
      };
      bodyText = JSON.stringify(body);
      pageState.lastActionPost = { bodyText, actionId, idempotencyKey };
    }

    const headers = {
      Accept:
        'application/vnd.agent-page-diff+json, application/vnd.agent-page+json, application/vnd.agent-page-error+json',
      'Content-Type': 'application/vnd.agent-page-action+json',
      [HEADER.CLIENT]: `extension/${EXT_VERSION}`,
      [HEADER.ACCEPT_VERSIONS]: `${APP_EXT}, ${APP_EXT_V11}`,
      [HEADER.IDEMPOTENCY_KEY]: idempotencyKey,
    };
    if (pageState.version) headers[HEADER.IF_MATCH_VERSION] = pageState.version;
    if (token) headers[HEADER.CONFIRMATION] = token;
    if (msg.payload.challenge_id) headers[HEADER.CHALLENGE] = msg.payload.challenge_id;
    if (msg.payload.hold_token) headers[HEADER.HOLD_TOKEN] = msg.payload.hold_token;
    if (msg.payload.resume_token) headers[HEADER.RESUME] = msg.payload.resume_token;

    try {
      // redirect:'follow' — 'manual' surfaces 303s as opaqueredirect (status 0,
      // headers stripped) in page-context fetches, so Form C navigations were
      // unreachable. Following the 303 GETs the target page; res.url is the
      // navigate target (§3.4). Cross-origin targets fail CORS → network error.
      const res = await fetch(actionUrl, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: bodyText,
        redirect: 'follow',
      });

      // Form C - Redirect (§3.4): a redirect was followed — res.url is the
      // Location/X-APP-Navigate target.
      if (res.redirected && res.url) {
        const locAbs = res.url;
        pageState.pendingAction = null;
        const resultVersion = res.headers.get(HEADER.RESULT_VERSION);
        captureResumeHeader(res);
        return actionResult(msg, {
          mode: 'redirect',
          url: locAbs,
          status: res.status,
          result_version: resultVersion,
          headers: headerMap(res),
        });
      }

      captureResumeHeader(res);
      const text = await res.text();
      let doc;
      try {
        doc = text ? JSON.parse(text) : null;
      } catch (e) {
        pageState.pendingAction = null;
        return actionResult(msg, {
          mode: 'error',
          document: {
            app: '1.0',
            error: {
              code: 'app.err.payload.invalid_json',
              message: e.message,
              retryable: true,
            },
          },
          status: res.status,
        });
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

      if ((mode === 'full' || mode === 'async') && doc?.page) {
        pageState.manifest = doc;
        pageState.version = resultVersion || doc.page.version;
        void ensureEventSubscription(doc);
      } else if (mode === 'diff' && resultVersion) {
        // Diffs bump page.version to result_version; without this every
        // subsequent action 409s on If-Match-Version (stale base).
        pageState.version = resultVersion;
      }

      // Form D - Async (§6.9): return immediately so renderer can show
      // operation_status; renderer polls status_url via FETCH_MANIFEST.
      if (mode === 'async' || res.status === 202) {
        pageState.pendingAction = null;
        const statusUrl =
          doc?.state?.operation_status?.value?.status_url?.value ||
          doc?.state?.operation_status?.value?.status_url ||
          null;
        const pollInterval = Math.max(500, Number(doc?.meta?.poll_interval_ms) || 2000);
        return actionResult(msg, {
          mode: 'async',
          document: doc,
          status: 202,
          action: actionId,
          params,
          result_version: resultVersion,
          status_url: statusUrl,
          poll_interval_ms: pollInterval,
          headers: headerMap(res),
        });
      }

      pageState.pendingAction = null;
      return actionResult(msg, {
        mode,
        document: doc,
        status: res.status,
        action: actionId,
        params,
        result_version: resultVersion,
        headers: headerMap(res),
        // Echo so renderer can re-POST identical bytes on 428 (Mode A)
        body_bytes_held: true,
      });
    } catch (e) {
      pageState.pendingAction = null;
      return actionResult(msg, {
        mode: 'error',
        document: {
          app: '1.0',
          error: {
            code: 'app.err.transport.network',
            message: e.message,
            retryable: true,
          },
        },
      });
    }
  }

  async function navigate(msg) {
    const next = msg.payload.url;
    try {
      assertSameOrigin(next);
    } catch (e) {
      return errorMsg(msg, 'app.err.security.cross_origin', e.message);
    }
    pageState.history.push(pageState.url);
    if (msg.payload.mode === 'replace') {
      location.replace(next);
    } else {
      location.assign(next);
    }
    return makeMsg('PONG', {}, msg.request_id, msg.tab_id);
  }

  function assertSameOrigin(url) {
    const u = new URL(url, location.href);
    if (u.origin !== pageState.origin) {
      throw new Error(`Rejected cross-origin request to ${u.origin}`);
    }
  }

  function actionResult(msg, payload) {
    return makeMsg('ACTION_RESULT', payload, msg.request_id, msg.tab_id);
  }

  function errorMsg(msg, code, message) {
    return makeMsg(
      'MANIFEST_ERROR',
      {
        error: {
          app: '1.0',
          error: { code, message, retryable: true },
        },
      },
      msg.request_id,
      msg.tab_id,
    );
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

  function safeSend(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch {
      /* sw asleep / no listener */
    }
  }

  function rid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `r_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isAppExt(msg)) return;
    if (msg.type === 'SETTINGS_UPDATE') {
      rendererApi?.renderer?.applySettings?.(msg.payload);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'PING') {
      // SW uses this for §14 preferred-path handoff (native/link → stay in-page).
      sendResponse(
        makeMsg(
          'PONG',
          {
            mode: pageState.mode,
            will_render: pageState.mode === 'native' || pageState.mode === 'link',
            url: pageState.url,
          },
          msg.request_id,
          msg.tab_id,
        ),
      );
      return;
    }
    if (
      msg.type === 'CONFIRM_RESPONSE' ||
      msg.type === 'CHALLENGE_RESPONSE' ||
      msg.type === 'HOLD_RESPONSE'
    ) {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'SESSION_EPOCH') {
      void handleSessionEpoch(msg);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'EVENT_PUSH') {
      rendererApi?.renderer?.handleEventPush?.(msg.payload?.event);
      sendResponse({ ok: true });
    }
  });
})();
