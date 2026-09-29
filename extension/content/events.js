/**
 * EventSource / long-poll Event Record subscription (§14 / §24.2).
 * Owned by the content script (SW eviction). No SSE in the service worker.
 */

import { createMessage, MessageType } from '../protocol/messages.js';
import { validateEventRecord } from '../protocol/validate.js';

const MEDIA_EVENT = 'application/vnd.agent-page-event+json';

/**
 * @typedef {object} EventSubscription
 * @property {() => void} close
 * @property {string|null} lastEventId
 */

/**
 * Subscribe to page events via SSE (preferred) or long-poll fallback.
 *
 * @param {object} opts
 * @param {string} opts.eventsUrl - same-origin events URL
 * @param {string} opts.pageUrl
 * @param {string} [opts.origin]
 * @param {string[]} [opts.types]
 * @param {(record: object) => void} opts.onEvent
 * @param {(err: Error) => void} [opts.onError]
 * @param {'sse'|'longpoll'|'auto'} [opts.mode]
 * @returns {EventSubscription}
 */
export function subscribeEvents(opts) {
  const { eventsUrl, pageUrl, types, onEvent, onError, mode = 'auto' } = opts;

  let closed = false;
  let lastEventId = null;
  /** @type {EventSource|null} */
  let es = null;
  /** @type {AbortController|null} */
  let pollAbort = null;
  let pollTimer = null;

  const url = buildEventsUrl(eventsUrl, pageUrl, types);

  function deliver(raw) {
    if (closed || raw == null) return;
    let doc = raw;
    if (typeof raw === 'string') {
      try {
        doc = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (doc?.ok === true && !doc.event) return; // handshake
    const v = validateEventRecord(doc);
    if (!v.ok) return;
    if (v.event.type === 'heartbeat') {
      lastEventId = v.event.id || lastEventId;
      return;
    }
    // Forward-compat: unknown types ignored after structural check
    if (!v.knownType && v.event.type !== 'heartbeat') {
      lastEventId = v.event.id || lastEventId;
      return;
    }
    lastEventId = v.event.id || lastEventId;
    try {
      onEvent(doc);
    } catch (e) {
      onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function startSse() {
    try {
      const sseUrl = new URL(url);
      if (lastEventId) {
        // Last-Event-ID is an HTTP header; EventSource sets it on reconnect.
      }
      es = new EventSource(sseUrl.href, { withCredentials: true });
      es.onmessage = (ev) => {
        if (ev.lastEventId) lastEventId = ev.lastEventId;
        deliver(ev.data);
      };
      es.addEventListener('message', (ev) => {
        if (ev.lastEventId) lastEventId = ev.lastEventId;
        deliver(ev.data);
      });
      es.onerror = () => {
        if (closed) return;
        // Fall back to long-poll if SSE dies and mode is auto
        if (mode === 'auto' || mode === 'longpoll') {
          try {
            es?.close();
          } catch {
            /* ignore */
          }
          es = null;
          startLongPoll();
        } else {
          onError?.(new Error('EventSource error'));
        }
      };
    } catch (e) {
      if (mode === 'sse') {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      } else {
        startLongPoll();
      }
    }
  }

  async function startLongPoll() {
    if (closed) return;
    pollAbort?.abort();
    pollAbort = new AbortController();
    try {
      const pollUrl = new URL(url);
      if (lastEventId) pollUrl.searchParams.set('after', lastEventId);
      const headers = {
        Accept: MEDIA_EVENT,
        'Cache-Control': 'no-store',
      };
      const res = await fetch(pollUrl.href, {
        method: 'GET',
        credentials: 'include',
        headers,
        signal: pollAbort.signal,
      });
      if (closed) return;
      if (res.status === 204) {
        schedulePoll(1000);
        return;
      }
      if (res.status === 401 || res.status === 403) {
        onError?.(new Error(`Events auth ${res.status}`));
        return;
      }
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      const text = await res.text();
      if (!text) {
        schedulePoll(1500);
        return;
      }
      if (ct.includes('event+json') || text.trim().startsWith('{')) {
        deliver(text);
      }
      schedulePoll(500);
    } catch (e) {
      if (closed || pollAbort?.signal.aborted) return;
      onError?.(e instanceof Error ? e : new Error(String(e)));
      schedulePoll(3000);
    }
  }

  function schedulePoll(ms) {
    if (closed) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void startLongPoll(), ms);
  }

  if (mode === 'longpoll') {
    void startLongPoll();
  } else {
    startSse();
  }

  return {
    get lastEventId() {
      return lastEventId;
    },
    close() {
      closed = true;
      clearTimeout(pollTimer);
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      pollAbort?.abort();
      es = null;
    },
  };
}

function buildEventsUrl(eventsUrl, pageUrl, types) {
  const u = new URL(eventsUrl, pageUrl);
  if (pageUrl) u.searchParams.set('page_url', pageUrl);
  if (Array.isArray(types) && types.length) {
    u.searchParams.set('types', types.join(','));
  }
  return u.href;
}

/**
 * Push an Event Record to the renderer via the content bridge callback.
 * @param {(msg: object) => void} push
 * @param {object} eventDoc
 */
export function pushEventToRenderer(push, eventDoc) {
  push(createMessage(MessageType.EVENT_PUSH, { event: eventDoc }));
}
