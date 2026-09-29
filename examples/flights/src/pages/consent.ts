import { randomBytes } from 'node:crypto';
import { AppError, bumpVersion, type ActionHandler, type PageManifest } from '@agent-page/server';
import {
  type DemoSession,
  type HoldSlot,
  type SessionStore,
  buildConsentStateNode,
  buildSessionStateNode,
} from '../sessions.js';
import {
  HOLD_KIND_OPTIONS,
  asManifest,
  boolNode,
  datetimeNode,
  enumNode,
  stringNode,
} from '../protocol.js';

const KNOWN_PURPOSES = new Set(['necessary', 'analytics', 'marketing']);

export function parseConsentPath(pathname: string): boolean {
  return pathname === '/consent';
}

export function parseHoldPath(pathname: string): string | null {
  const m = /^\/holds\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return decodeURIComponent(m[1]!);
}

function holdNode(hold: HoldSlot): import('@agent-page/server').StateNode {
  return {
    type: 'object',
    label: 'Human verification',
    value: {
      id: stringNode(hold.id),
      kind: enumNode(hold.kind, HOLD_KIND_OPTIONS),
      status: enumNode(hold.cleared ? 'cleared' : 'pending', [
        'pending',
        'cleared',
        'expired',
        'failed',
      ]),
      verify_url: stringNode(hold.verifyUrl),
      resume_action: stringNode('complete_hold'),
      expires_at: datetimeNode(hold.expiresAt),
      ttl_ms: { type: 'number', value: hold.ttlMs },
      who: enumNode('human', ['human']),
      agent_solvable: boolNode(false),
      issued_count: { type: 'number', value: 1 },
    },
  };
}

export function buildConsentManifest(
  pageOrigin: string,
  session: DemoSession | undefined,
  options?: { version?: string },
): PageManifest {
  const alertsOn = session?.consent.analytics === true;
  return asManifest({
    app: '1.1',
    page: {
      id: 'consent',
      url: `${pageOrigin}/consent`,
      title: 'Privacy and alerts',
      version: options?.version ?? 'c-1',
      etag: 'W/"consent-1"',
      description: 'Grant optional purposes and subscribe to fare alerts',
    },
    state: {
      session: buildSessionStateNode(session),
      consent: buildConsentStateNode(session),
      alerts_subscribed: boolNode(alertsOn, 'Fare alerts'),
    },
    actions: {
      grant_consent: {
        description: 'Save consent preferences',
        kind: 'mutate',
        input: {
          purposes: {
            type: 'array',
            required: true,
            min_items: 1,
            max_items: 32,
            item_type: {
              type: 'object',
              properties: {
                id: { type: 'string', required: true, max_length: 64 },
                granted: { type: 'boolean', required: true },
              },
            },
          },
        },
        output: { state_diff: true },
        side_effect: 'identity',
        idempotent: true,
        timeout_ms: 10000,
        auth: 'none',
      },
      subscribe_alerts: {
        description: 'Email fare-drop alerts (requires analytics consent)',
        kind: 'mutate',
        input: {
          email: { type: 'string', required: true, min_length: 3, max_length: 254 },
        },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 10000,
        auth: 'none',
        policy: { consent_purposes: ['analytics'] },
      },
      join_loyalty: {
        description: 'Join the loyalty programme (human TOS hold)',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: false,
        timeout_ms: 15000,
        auth: 'none',
      },
    },
    navigation: {
      breadcrumb: [
        { label: 'Search', url: `${pageOrigin}/flights`, page_id: 'flight-search', rel: 'up' },
        { label: 'Privacy', url: `${pageOrigin}/consent`, page_id: 'consent' },
      ],
    },
    present: { layout: 'form' },
    meta: { cache: { public: false, max_age: 0 } },
  });
}

export function buildHoldManifest(
  pageOrigin: string,
  hold: HoldSlot,
  session: DemoSession | undefined,
): PageManifest {
  return asManifest({
    app: '1.1',
    page: {
      id: 'human-hold',
      url: hold.verifyUrl,
      title: 'Confirm terms',
      version: hold.cleared ? 'h-2' : 'h-1',
      etag: hold.cleared ? 'W/"hold-cleared"' : 'W/"hold-1"',
    },
    state: {
      session: buildSessionStateNode(session),
      hold: holdNode(hold),
    },
    actions: hold.cleared
      ? {}
      : {
          complete_hold: {
            description: 'Human accepts the loyalty terms',
            kind: 'mutate',
            input: { accepted: { type: 'boolean', required: true } },
            output: { state_diff: true, navigates_to: `${pageOrigin}/consent` },
            side_effect: 'safe',
            idempotent: false,
            timeout_ms: 15000,
            auth: 'none',
          },
        },
    meta: { cache: { public: false, max_age: 0 } },
  });
}

export function createConsentHandlers(
  pageOrigin: string,
  store: SessionStore,
  holds: Map<string, HoldSlot>,
): Record<string, ActionHandler> {
  return {
    grant_consent: async ({ params, sessionId, manifest }) => {
      const session = store.getOrCreate(sessionId);
      const raw = params.purposes;
      if (!Array.isArray(raw)) {
        throw new AppError('app.err.validation.param_type', { path: '/params/purposes' });
      }
      const purposes: Array<{ id: string; granted: boolean }> = [];
      for (const item of raw) {
        if (!item || typeof item !== 'object') {
          throw new AppError('app.err.validation.param_type', { path: '/params/purposes' });
        }
        const rec = item as { id?: unknown; granted?: unknown };
        const id = String(rec.id ?? '');
        if (!KNOWN_PURPOSES.has(id)) {
          throw new AppError('app.err.consent.unknown_purpose', {
            details: { id: stringNode(id) },
          });
        }
        purposes.push({ id, granted: rec.granted === true });
      }
      store.grantConsent(session, purposes);
      const next = buildConsentManifest(pageOrigin, session, {
        version: bumpVersion(manifest.page.version),
      });
      return { type: 'diff', nextManifest: next };
    },

    subscribe_alerts: async ({ params, sessionId, manifest }) => {
      const session = store.getOrCreate(sessionId);
      if (!store.hasPurpose(session, 'analytics')) {
        throw new AppError('app.err.consent.required', {
          details: {
            missing: {
              type: 'array',
              value: [{ type: 'string', value: 'analytics' }],
            },
          },
          recoverable_actions: ['grant_consent'],
        });
      }
      void params.email;
      session.consent.analytics = true;
      const next = buildConsentManifest(pageOrigin, session, {
        version: bumpVersion(manifest.page.version),
      });
      next.state.alerts_subscribed = boolNode(true, 'Fare alerts');
      return { type: 'diff', nextManifest: next };
    },

    join_loyalty: async ({ sessionId }) => {
      const session = store.getOrCreate(sessionId);
      if (
        session.hold &&
        !session.hold.cleared &&
        Date.parse(session.hold.expiresAt) > Date.now()
      ) {
        throw new AppError('app.err.hold.human_required', {
          details: { hold: holdNode(session.hold) },
        });
      }
      const ttlMs = 300000;
      const id = `hold_${randomBytes(16).toString('hex')}`;
      const hold: HoldSlot = {
        id,
        kind: 'tos',
        action: 'join_loyalty',
        verifyUrl: `${pageOrigin}/holds/${id}`,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        ttlMs,
        cleared: false,
      };
      session.hold = hold;
      holds.set(id, hold);
      throw new AppError('app.err.hold.human_required', {
        details: { hold: holdNode(hold) },
      });
    },
  };
}

export function createHoldHandlers(
  pageOrigin: string,
  store: SessionStore,
  holds: Map<string, HoldSlot>,
): Record<string, ActionHandler> {
  return {
    complete_hold: async ({ params, sessionId, manifest }) => {
      const holdId = parseHoldPath(new URL(manifest.page.url).pathname);
      if (!holdId) throw new AppError('app.err.page.not_found');
      const hold = holds.get(holdId);
      if (!hold) throw new AppError('app.err.hold.invalid');
      if (Date.parse(hold.expiresAt) < Date.now()) {
        throw new AppError('app.err.hold.expired');
      }
      if (params.accepted !== true) {
        throw new AppError('app.err.hold.invalid', { message: 'Terms were not accepted' });
      }
      hold.cleared = true;
      const session = store.get(sessionId);
      if (session?.hold?.id === hold.id) session.hold.cleared = true;
      return { type: 'navigate', url: `${pageOrigin}/consent`, mode: 'replace' };
    },
  };
}
