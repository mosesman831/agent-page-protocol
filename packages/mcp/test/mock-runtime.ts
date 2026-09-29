/**
 * In-memory ToolRuntime for MCP unit tests (matches §11.2 method shapes).
 */

import type { SessionLike, ToolArgs, ToolEnvelope, ToolRuntime } from '../src/runtime.js';

function baseOk(partial: Partial<ToolEnvelope> = {}): ToolEnvelope {
  return {
    app: '1.0',
    tool: '1.0',
    ok: true,
    status: 'ok',
    session: partial.session ?? 'ses_TESTSESSION0001',
    ...partial,
  };
}

function baseErr(
  code: string,
  message: string,
  http_status: number | null = null,
  session: string | null = null,
): ToolEnvelope {
  return {
    app: '1.0',
    tool: '1.0',
    ok: false,
    status: 'error',
    session,
    error: { code, message, retryable: false, http_status },
  };
}

interface InternalSession extends SessionLike {
  current: {
    page_id: string;
    url: string;
    version: string;
    etag?: string | null;
    title?: string | null;
  };
}

export interface MockState {
  current: string | null;
  sessions: Map<string, InternalSession>;
  manifests: Map<string, Record<string, unknown>>;
  holds: Map<string, Record<string, unknown>>;
  wellKnown: Map<string, Record<string, unknown>>;
  nextAct?: (action: string, args: ToolArgs) => Promise<ToolEnvelope> | ToolEnvelope;
}

export function createMockRuntime(init: Partial<MockState> = {}): {
  runtime: ToolRuntime;
  state: MockState;
} {
  const state: MockState = {
    current: init.current ?? null,
    sessions: init.sessions ?? new Map(),
    manifests: init.manifests ?? new Map(),
    holds: init.holds ?? new Map(),
    wellKnown: init.wellKnown ?? new Map(),
    nextAct: init.nextAct,
  };

  const store = {
    listSessions(): SessionLike[] {
      return [...state.sessions.values()];
    },
    readSession(id: string): SessionLike {
      const s = state.sessions.get(id);
      if (!s) throw new Error(`unknown session ${id}`);
      return s;
    },
    readPublicCache(url: string): { manifest?: Record<string, unknown> } | null {
      for (const [sid, sess] of state.sessions) {
        if (sess.current.url === url) {
          const m = state.manifests.get(sid);
          return m ? { manifest: m } : null;
        }
      }
      return null;
    },
    currentSessionId(explicit?: string | null): string | null {
      return explicit ?? state.current;
    },
  };

  const holds = {
    load(sessionId: string): Record<string, unknown> | null {
      return state.holds.get(sessionId) ?? null;
    },
  };

  const runtime: ToolRuntime = {
    store,
    holds,

    getCurrentSessionId() {
      return state.current;
    },

    async discover(args: ToolArgs) {
      const originOrUrl = String(args.url ?? '');
      let origin: string;
      try {
        origin = new URL(originOrUrl.includes('://') ? originOrUrl : `https://${originOrUrl}`)
          .origin;
      } catch {
        return baseErr('app.err.http.bad_url', 'Invalid URL', 400);
      }
      const discovery = {
        origin,
        well_known_url: `${origin}/.well-known/agent-page`,
        supported: true,
        site_name: 'Mock Site',
        protocol_version: '1.0',
        capabilities: [],
        entry_urls: {},
      };
      state.wellKnown.set(origin, discovery);
      return baseOk({ discovery, session: state.current });
    },

    async open(args: ToolArgs) {
      const url = String(args.url ?? '');
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return baseErr('app.err.http.bad_url', 'Invalid URL', 400);
      }
      const id =
        (typeof args.session_id === 'string' && args.session_id) ||
        (typeof args.session === 'string' && args.session) ||
        `ses_${Buffer.from(url).toString('base64url').slice(0, 22)}`;
      const pageId = url.includes('results') ? 'flight_results' : 'flight_search';
      const actions =
        pageId === 'flight_search'
          ? [
              {
                id: 'search',
                description: 'Search flights',
                kind: 'query',
                side_effect: 'safe',
                requires_confirmation: false,
                idempotent: true,
                auth: 'none',
                input: {
                  type: 'object',
                  properties: {
                    origin: { type: 'string' },
                    destination: { type: 'string' },
                  },
                  required: ['origin', 'destination'],
                },
              },
            ]
          : [
              {
                id: 'filter',
                description: 'Filter results by max price',
                kind: 'query',
                side_effect: 'safe',
                requires_confirmation: false,
                idempotent: true,
                auth: 'none',
                input: {
                  type: 'object',
                  properties: { max_price: { type: 'number' } },
                },
              },
            ];
      const session: InternalSession = {
        id,
        origin,
        current: {
          page_id: pageId,
          url,
          version: 'v1',
        },
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      state.sessions.set(id, session);
      state.current = id;
      const digest = {
        page: { id: pageId, url, version: 'v1' },
        state: {},
        actions,
      };
      state.manifests.set(id, {
        app: '1.0',
        page: digest.page,
        state: {},
        actions,
      });
      return baseOk({
        session: id,
        page: digest.page,
        digest,
      });
    },

    async read(args: ToolArgs) {
      const id = state.current;
      if (!id) return baseErr('app.err.tool.session_missing', 'No current session');
      const manifest = state.manifests.get(id);
      if (!manifest) return baseErr('app.err.tool.session_missing', 'Unknown session', null, id);
      const digest = {
        page: manifest.page as Record<string, unknown>,
        state: (manifest.state as Record<string, unknown>) ?? {},
        actions: (manifest.actions as Array<Record<string, unknown>>) ?? [],
      };
      const d = args.actions_only === true ? { ...digest, state: {} } : digest;
      return baseOk({ session: id, page: digest.page, digest: d });
    },

    async act(args: ToolArgs) {
      const action = String(args.action ?? '');
      if (state.nextAct) return state.nextAct(action, args);
      const id = state.current;
      if (!id) return baseErr('app.err.tool.session_missing', 'No current session');

      if (action === 'confirm_booking') {
        const hold = {
          kind: 'confirmation',
          action: 'confirm_booking',
          page_url: state.sessions.get(id)?.current.url ?? 'http://localhost/booking',
          page_version: 'v1',
          level: 'L3',
          side_effect: 'financial',
          title: 'Confirm payment',
          body: 'Pay 640.00',
          amount: { value: 64000, unit: 'USD', scale: 2 },
          challenge: 'chal_test',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          raw_body_b64: Buffer.from('{"action":"confirm_booking"}').toString('base64'),
          body_sha256: 'a'.repeat(64),
        };
        state.holds.set(id, hold);
        const sess = state.sessions.get(id);
        if (sess) sess.hold_kind = 'confirmation';
        return {
          app: '1.0',
          tool: '1.0',
          ok: false,
          status: 'hold',
          session: id,
          hold: {
            kind: hold.kind,
            action: hold.action,
            page_url: hold.page_url,
            page_version: hold.page_version,
            level: hold.level,
            side_effect: hold.side_effect,
            title: hold.title,
            body: hold.body,
            amount: hold.amount,
            challenge: hold.challenge,
            expires_at: hold.expires_at,
          },
        };
      }

      if (action === 'search') {
        const sess = state.sessions.get(id);
        const resultsUrl = `${sess?.origin ?? 'http://localhost'}/flights/results`;
        return runtime.open({ url: resultsUrl, session: id });
      }

      if (action === 'missing_page') {
        return baseErr('app.err.http.not_found', 'Page not found', 404, id);
      }

      return baseOk({
        session: id,
        act: {
          action,
          mode: 'diff',
          base_version: 'v1',
          result_version: 'v2',
          diff: [],
          state_delta: {},
        },
      });
    },

    async confirm(args: ToolArgs) {
      const id = state.current;
      if (!id) return baseErr('app.err.tool.session_missing', 'No current session');
      if (!state.holds.has(id)) {
        return baseErr('app.err.tool.hold_mismatch', 'No matching hold', null, id);
      }
      if (args.decision === 'reject') {
        state.holds.delete(id);
        return baseOk({ status: 'closed', ok: true, session: id });
      }
      state.holds.delete(id);
      return baseOk({
        session: id,
        status: 'async_succeeded',
        act: {
          action: 'confirm_booking',
          mode: 'async',
          result_version: 'v3',
          base_version: 'v1',
        },
      });
    },

    async challenge(args: ToolArgs) {
      return baseErr(
        'app.err.tool.hold_unsupported',
        `Challenge ${String(args.kind ?? '')} not available`,
        null,
        state.current,
      );
    },

    async watch(args: ToolArgs) {
      const id = state.current;
      if (!id) return baseErr('app.err.tool.session_missing', 'No current session');
      if (args.mode === 'subscribe') {
        return baseOk({
          session: id,
          watch: {
            transport: 'poll',
            changed: false,
            subscription_id: 'sub_01HWATCH',
            interval_ms: typeof args.interval_ms === 'number' ? args.interval_ms : 5000,
            last_event_id: null,
          },
        });
      }
      return baseOk({
        session: id,
        status: 'not_modified',
        watch: {
          transport: 'poll',
          changed: false,
          interval_ms: typeof args.interval_ms === 'number' ? args.interval_ms : 5000,
          last_event_id: null,
        },
      });
    },

    async sessions(args: ToolArgs) {
      const op = String(args.op ?? 'list');
      const id = typeof args.session === 'string' ? args.session : undefined;
      if (op === 'list') {
        return baseOk({
          session: state.current,
          sessions: [...state.sessions.values()].map((s) => ({
            id: s.id,
            origin: s.origin,
            current_page_id: s.current.page_id,
            current_url: s.current.url,
            current_version: s.current.version,
            updated_at: s.updated_at,
          })),
        });
      }
      if (op === 'switch') {
        const sid = id ?? '';
        if (!state.sessions.has(sid)) {
          return baseErr('app.err.tool.session_missing', 'Unknown session');
        }
        state.current = sid;
        return baseOk({ session: sid });
      }
      if (op === 'close') {
        const sid = id ?? '';
        state.sessions.delete(sid);
        state.holds.delete(sid);
        if (state.current === sid) state.current = null;
        return baseOk({ status: 'closed', session: state.current });
      }
      if (op === 'gc') {
        return baseOk({ session: state.current });
      }
      const sid = id ?? state.current;
      if (!sid || !state.sessions.has(sid)) {
        return baseErr('app.err.tool.session_missing', 'Unknown session');
      }
      return baseOk({ session: sid });
    },

    async logout(_args: ToolArgs) {
      return baseOk({ session: state.current, status: 'closed' });
    },

    async reset(args: ToolArgs) {
      if (args.all === true) {
        state.sessions.clear();
        state.holds.clear();
        state.manifests.clear();
        state.current = null;
        return baseOk({ status: 'closed', session: null });
      }
      const id = typeof args.session === 'string' ? args.session : state.current;
      if (id) {
        state.sessions.delete(id);
        state.holds.delete(id);
        if (state.current === id) state.current = null;
      }
      return baseOk({ status: 'closed', session: state.current });
    },
  };

  return { runtime, state };
}
