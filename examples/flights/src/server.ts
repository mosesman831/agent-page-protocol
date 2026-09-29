/**
 * Appendix D flight booking example server. APP 1.1 dual-speak (v0.4 flow intact).
 * Page origin: http://localhost:${PORT} (default 3456). Binds 0.0.0.0.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import {
  createPageHandler,
  MemoryAsyncJobStore,
  MemoryConfirmationStore,
  MemoryIdempotencyStore,
  type GetManifest,
  type PageManifest,
  type RequestWithRawBody,
} from '@agent-page/server';

import { buildWellKnownManifest, createWellKnownHandlers } from './well-known.js';
import { buildSearchManifest, createSearchHandlers, type SearchStore } from './pages/search.js';
import {
  buildResultsManifest,
  canonicalizeResultsKey,
  createResultsHandlers,
  parseResultsPath,
  type ResultsStore,
} from './pages/results.js';
import {
  createBookingHandlers,
  createOperationsGetManifest,
  createOperationsHandlers,
  getOrBuildBooking,
  parseBookingPath,
  type BookingJobContextStore,
  type BookingStore,
} from './pages/booking.js';
import { buildLoginManifest, createLoginHandlers } from './pages/login.js';
import { buildMfaManifest, createMfaHandlers } from './pages/mfa.js';
import {
  buildConsentManifest,
  buildHoldManifest,
  createConsentHandlers,
  createHoldHandlers,
  parseHoldPath,
} from './pages/consent.js';
import {
  buildOrderManifest,
  createOrderHandlers,
  parseOrderPath,
  seedDemoOrders,
  type OrderStore,
} from './pages/order.js';
import {
  buildPay3dsManifest,
  createPay3dsHandlers,
  parse3dsCallbackPath,
  parsePayPath,
} from './pages/pay-3ds.js';
import { EventBus, createEventsRouter } from './events.js';
import { loadPaymentConfig, loadProvider } from './payments/adapter.js';
import { beginCheckout } from './payments/checkout.js';
import { mountPaymentRoutes } from './payments/routes.js';
import {
  SessionStore,
  cookieHeader,
  parseSessionCookie,
  resolveSession,
  type HoldSlot,
} from './sessions.js';
import { finalizeManifest } from './protocol.js';
import type { ActionHandler } from '@agent-page/server';
import type { OrderValue } from './protocol.js';

export function createApp(env: NodeJS.ProcessEnv = process.env): express.Express {
  const PORT = Number(env.PORT) || 3456;
  const pageOrigin = env.PAGE_ORIGIN ?? `http://localhost:${PORT}`;
  const paymentConfig = loadPaymentConfig(env);

  const resultsStore: ResultsStore = new Map();
  const searchStore: SearchStore = new Map();
  const bookingStore: BookingStore = new Map();
  const bookingJobContexts: BookingJobContextStore = new Map();
  const orderStore: OrderStore = new Map();
  const holdStore = new Map<string, HoldSlot>();
  const sessions = new SessionStore();
  const eventBus = new EventBus();
  const idempotencyStore = new MemoryIdempotencyStore();
  const confirmationStore = new MemoryConfirmationStore();
  const asyncJobStore = new MemoryAsyncJobStore();

  seedDemoOrders(pageOrigin, orderStore);

  const shared = {
    pageOrigin,
    idempotencyStore,
    confirmationStore,
    asyncJobStore,
    getSessionId: (req: express.Request) => {
      const resolved = resolveSession(
        sessions,
        req.headers as Record<string, string | string[] | undefined>,
      );
      if (resolved) return resolved.id;
      const cookie = req.headers.cookie ?? '';
      const m = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
      return m?.[1] ?? 'anon';
    },
    // Contract D-8: missing cookie is identity anon so the §13 smoke path works
    // without a prior login. Page handlers still enforce login where required.
    authenticate: async () => ({ ok: true as const }),
    authorize: async () => ({ ok: true as const }),
  };

  function urlPath(url: string): { pathname: string; searchParams: URLSearchParams } {
    const u = new URL(url);
    return { pathname: u.pathname, searchParams: u.searchParams };
  }

  function stamp(
    canonical: PageManifest | null,
    headers: Record<string, string | string[] | undefined>,
  ): PageManifest | null {
    if (!canonical) return null;
    return finalizeManifest(canonical, headers);
  }

  function stampHandlers(handlers: Record<string, ActionHandler>): Record<string, ActionHandler> {
    const out: Record<string, ActionHandler> = {};
    for (const [id, handler] of Object.entries(handlers)) {
      out[id] = async (ctx) => {
        const result = await handler(ctx);
        if (result.type === 'diff') {
          return { ...result, nextManifest: finalizeManifest(result.nextManifest, ctx.headers) };
        }
        if (result.type === 'full') {
          return { ...result, manifest: finalizeManifest(result.manifest, ctx.headers) };
        }
        return result;
      };
    }
    return out;
  }

  const getWellKnown: GetManifest = async ({ headers }) =>
    stamp(buildWellKnownManifest(pageOrigin), headers);

  const getSearch: GetManifest = async ({ headers }) => {
    const session = resolveSession(sessions, headers);
    const cached = searchStore.get(`${pageOrigin}/flights`);
    if (cached) return stamp(cached, headers);
    return stamp(buildSearchManifest(pageOrigin, { session }), headers);
  };

  const getResults: GetManifest = async ({ url, headers }) => {
    const { pathname, searchParams } = urlPath(url);
    const parsed = parseResultsPath(pathname);
    if (!parsed) return null;
    const pax = Number(searchParams.get('pax') ?? '1');
    const route = { ...parsed, pax: Number.isFinite(pax) && pax >= 1 ? pax : 1 };
    const pageUrl = `${pageOrigin}/flights/${route.origin}/${route.destination}/${route.date}?pax=${route.pax}`;
    const key = canonicalizeResultsKey(pageUrl);
    const cached = resultsStore.get(pageUrl) ?? resultsStore.get(key);
    if (cached) return stamp(cached, headers);
    const session = resolveSession(sessions, headers);
    const built = buildResultsManifest(pageOrigin, route, { session });
    resultsStore.set(pageUrl, built);
    resultsStore.set(key, built);
    return stamp(built, headers);
  };

  const getBooking: GetManifest = async ({ url, headers }) => {
    const { pathname } = urlPath(url);
    const flightId = parseBookingPath(pathname);
    if (!flightId) return null;
    const built = getOrBuildBooking(pageOrigin, flightId, bookingStore);
    return stamp(built, headers);
  };

  const getOperation = createOperationsGetManifest(
    pageOrigin,
    asyncJobStore,
    bookingJobContexts,
    bookingStore,
    orderStore,
    eventBus,
  );

  const getLogin: GetManifest = async ({ url, headers }) => {
    const { pathname } = urlPath(url);
    const session = resolveSession(sessions, headers);
    const logoutPage = pathname === '/logout';
    return stamp(buildLoginManifest(pageOrigin, session, { logoutPage }), headers);
  };

  const getMfa: GetManifest = async ({ headers }) => {
    const session = resolveSession(sessions, headers);
    const built = buildMfaManifest(pageOrigin, session);
    return stamp(built, headers);
  };

  const getConsent: GetManifest = async ({ headers }) => {
    const session = resolveSession(sessions, headers);
    return stamp(buildConsentManifest(pageOrigin, session), headers);
  };

  const getHold: GetManifest = async ({ url, headers }) => {
    const { pathname } = urlPath(url);
    const id = parseHoldPath(pathname);
    if (!id) return null;
    const hold = holdStore.get(id);
    if (!hold) return null;
    const session = resolveSession(sessions, headers);
    return stamp(buildHoldManifest(pageOrigin, hold, session), headers);
  };

  const getOrder: GetManifest = async ({ url, headers }) => {
    const { pathname } = urlPath(url);
    const id = parseOrderPath(pathname);
    if (!id) return null;
    const order = orderStore.get(id);
    if (!order) return null;
    const session = resolveSession(sessions, headers);
    return stamp(buildOrderManifest(pageOrigin, order, session), headers);
  };

  const getPay: GetManifest = async ({ url, headers }) => {
    const { pathname } = urlPath(url);
    const id = parsePayPath(pathname) ?? parse3dsCallbackPath(pathname);
    if (!id) return null;
    const order = orderStore.get(id);
    if (!order) return null;
    const session = resolveSession(sessions, headers);
    const kind = parse3dsCallbackPath(pathname) ? 'callback' : 'pay';
    return stamp(buildPay3dsManifest(pageOrigin, order, session, kind), headers);
  };

  function wrapIdentityHeaders(handler: express.RequestHandler): express.RequestHandler {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const origJson = res.json.bind(res);
      res.json = (body: unknown) => {
        const reqId = String(res.getHeader('X-APP-Request-Id') ?? '');
        const issuance = sessions.takeIssuance(reqId);
        if (issuance) {
          const existingCookie = parseSessionCookie(req.headers.cookie);
          if (issuance.expireCookie) {
            res.setHeader('Set-Cookie', cookieHeader(issuance.sessionId, true));
            res.setHeader('Set-APP-Resume', '; ttl=0');
          } else {
            if (existingCookie !== issuance.sessionId) {
              res.setHeader('Set-Cookie', cookieHeader(issuance.sessionId));
            }
            if (issuance.accessToken) {
              res.setHeader('X-APP-Access-Token', issuance.accessToken);
              res.setHeader('X-APP-Access-Token-TTL', '3600');
            }
            if (issuance.refreshToken) {
              res.setHeader('X-APP-Refresh-Token', issuance.refreshToken);
            }
            if (issuance.resumeToken) {
              res.setHeader('Set-APP-Resume', `${issuance.resumeToken}; ttl=86400`);
            }
          }
        }
        return origJson(body);
      };
      return handler(req, res, next);
    };
  }

  const app = express();
  app.disable('x-powered-by');

  // CORS (read-only GET for renderers/extension shells; §10.3).
  const CORS_ALLOW = env.CORS_ALLOW_ORIGIN ?? '*';
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.headers.origin;
    if (origin && req.method === 'GET') {
      const allowed =
        CORS_ALLOW === '*' ||
        CORS_ALLOW.split(',')
          .map((s) => s.trim())
          .includes(origin);
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', CORS_ALLOW === '*' ? '*' : origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Accept, X-APP-Version, X-APP-Client, X-APP-Accept-Versions, If-None-Match, Last-Event-ID, X-APP-Access-Token, X-APP-Resume',
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      }
    }
    next();
  });

  // Capture exact raw body bytes for confirmation SHA-256 binding (C10 / §10.4).
  // Webhook HMAC uses its own raw parser so express.json cannot re-serialize the body.
  const jsonParser = express.json({
    limit: '64kb',
    type: ['application/json', 'application/vnd.agent-page-action+json', 'application/*+json'],
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = Buffer.from(buf);
    },
  });
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method === 'POST' && req.path === '/webhooks/payment') {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  // Trailing slash → 308 for well-known (SPEC §4.1)
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path === '/.well-known/agent-page/' && req.method === 'GET') {
      res.redirect(308, '/.well-known/agent-page');
      return;
    }
    next();
  });

  const pageOpts = { ...shared };
  const paymentDeps = {
    config: paymentConfig,
    adapter: loadProvider(paymentConfig),
    pageOrigin,
    store: orderStore,
    bus: eventBus,
  };
  const payHandlers = stampHandlers(
    createPay3dsHandlers(pageOrigin, orderStore, eventBus, {
      beginCheckout: (order: OrderValue) => beginCheckout(paymentDeps, order),
    }),
  );

  app.all(
    '/.well-known/agent-page',
    createPageHandler({
      ...pageOpts,
      getManifest: getWellKnown,
      actionHandlers: stampHandlers(createWellKnownHandlers(pageOrigin)),
    }),
  );

  app.all(
    '/flights',
    createPageHandler({
      ...pageOpts,
      getManifest: getSearch,
      actionHandlers: stampHandlers(createSearchHandlers(pageOrigin, searchStore)),
    }),
  );

  app.all(
    '/flights/:origin/:destination/:date',
    createPageHandler({
      ...pageOpts,
      getManifest: getResults,
      actionHandlers: stampHandlers(createResultsHandlers(pageOrigin, resultsStore, eventBus)),
    }),
  );

  app.all(
    '/booking/:flightId',
    createPageHandler({
      ...pageOpts,
      getManifest: getBooking,
      actionHandlers: stampHandlers(createBookingHandlers(pageOrigin, bookingJobContexts)),
    }),
  );

  app.all(
    '/operations/:jobId',
    createPageHandler({
      ...pageOpts,
      getManifest: async (req) => stamp(await getOperation(req), req.headers),
      actionHandlers: stampHandlers(createOperationsHandlers(asyncJobStore, bookingJobContexts)),
    }),
  );

  app.all(
    '/login',
    wrapIdentityHeaders(
      createPageHandler({
        ...pageOpts,
        getManifest: getLogin,
        actionHandlers: stampHandlers(createLoginHandlers(pageOrigin, sessions)),
      }),
    ),
  );

  app.all(
    '/logout',
    wrapIdentityHeaders(
      createPageHandler({
        ...pageOpts,
        getManifest: getLogin,
        actionHandlers: stampHandlers(createLoginHandlers(pageOrigin, sessions)),
      }),
    ),
  );

  app.all(
    '/mfa',
    wrapIdentityHeaders(
      createPageHandler({
        ...pageOpts,
        getManifest: getMfa,
        actionHandlers: stampHandlers({
          ...createLoginHandlers(pageOrigin, sessions),
          ...createMfaHandlers(pageOrigin, sessions),
        }),
      }),
    ),
  );

  app.all(
    '/consent',
    wrapIdentityHeaders(
      createPageHandler({
        ...pageOpts,
        getManifest: getConsent,
        actionHandlers: stampHandlers(createConsentHandlers(pageOrigin, sessions, holdStore)),
      }),
    ),
  );

  app.all(
    '/holds/:holdId',
    createPageHandler({
      ...pageOpts,
      getManifest: getHold,
      actionHandlers: stampHandlers(createHoldHandlers(pageOrigin, sessions, holdStore)),
    }),
  );

  app.all(
    '/orders/:orderId/pay',
    createPageHandler({
      ...pageOpts,
      validateManifests: false,
      getManifest: getPay,
      actionHandlers: payHandlers,
    }),
  );

  app.all(
    '/orders/:orderId/3ds-callback',
    createPageHandler({
      ...pageOpts,
      validateManifests: false,
      getManifest: getPay,
      actionHandlers: payHandlers,
    }),
  );

  app.all(
    '/orders/:orderId',
    createPageHandler({
      ...pageOpts,
      validateManifests: false,
      getManifest: getOrder,
      actionHandlers: stampHandlers(createOrderHandlers(pageOrigin, orderStore, eventBus)),
    }),
  );

  mountPaymentRoutes(app, paymentDeps);

  app.use('/app-events', createEventsRouter(pageOrigin, eventBus));

  app.get('/', (_req: express.Request, res: express.Response) => {
    res.redirect(302, '/flights');
  });

  app.use(
    (
      err: { type?: string; status?: number },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err?.type === 'entity.too.large' || err?.status === 413) {
        res
          .status(413)
          .type('application/vnd.agent-page-error+json')
          .json({
            app: '1.0',
            error: {
              code: 'app.err.payload.too_large',
              message: 'Request body exceeds size limit',
              retryable: false,
              http_status: 413,
            },
          });
        return;
      }
      next(err);
    },
  );

  return app;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const port = Number(process.env.PORT) || 3456;
  const origin = process.env.PAGE_ORIGIN ?? `http://localhost:${port}`;
  const app = createApp(process.env);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Acme Flights APP 1.1 example listening on ${origin} (0.0.0.0:${port})`);
  });
}

export type { PageManifest };
