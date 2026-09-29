/**
 * Full-protocol demo app — wraps the demo sites' manifests in the real
 * @agent-page/server middleware (createPageHandler), so the demo server gets
 * negotiation, version pinning, CSRF, ETag/304, idempotency, confirmation
 * challenges, diff responses, async jobs, and correct error envelopes for free.
 *
 * Imported dynamically by serve.mjs; requires `npm run build` (packages/server
 * dist). Falls back to the basic handler when the build is absent.
 *
 * The page store is mutable per-process: action handlers may clone-and-bump a
 * manifest and store it back so subsequent GETs / conditional-GET watches see
 * the change. That keeps the demo single-user (fine) and stateful (needed).
 */

import { randomBytes } from 'node:crypto';
import { makeMvaHandlers } from './multiversal/handlers.mjs';
import { makeGcHandlers } from './google-classroom/handlers.mjs';
import { makeHotelHandlers } from './hotel-booking/handlers.mjs';
import { mountSiteRoutes } from './lib/site-routes.mjs';

const bump = (v) => {
  const m = /^(.*?)(\d+)$/.exec(String(v));
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${v}-2`;
};

const LAB_OTP = '123456';

/**
 * @param {object} opts
 * @param {Map<string, Map<string, object>>} opts.sites site -> slug -> manifest
 * @param {string} opts.origin e.g. http://127.0.0.1:8788
 * @param {(id: string, msg: string) => void} [opts.log]
 * @param {{express: Function, server: object}} [opts.deps] pre-imported modules —
 *   serverless bundlers (Vercel NFT) can't trace the dynamic imports above, so
 *   api/index.mjs passes `import express` + `import * as server` in explicitly.
 * @param {Object<string, object>} [opts.skins] site -> DOM skin (see
 *   demo/multiversal/skin.mjs) — enables the negotiated /site/<site>/<slug>
 *   HTML surface rendered from the same manifests.
 */
export async function createFullDemoApp({
  sites,
  origin,
  log = () => {},
  deps = null,
  skins = {},
}) {
  const express = deps?.express ?? (await import('express')).default;
  const {
    createPageHandler,
    AppError,
    MemoryAsyncJobStore,
    MemoryRateBucket,
    validateBulkItems,
    runBulk,
    MemoryChallengeStore,
    issueOtpChallenge,
    challengeToObject,
    verifyOtp,
    spendChallenge,
    MEDIA_PAGE,
    MEDIA_EVENT_STREAM,
    HEADER_APP_VERSION,
    HEADER_APP_RESPONSE_MODE,
    installAppBodyParsing,
    appBodyErrorHandler,
    createAuthServer,
  } = deps?.server ?? (await import('@agent-page/server'));

  const app = express();
  app.disable('x-powered-by');
  installAppBodyParsing(app);

  // ---- mutable state -------------------------------------------------------
  // livePages: pathname -> manifest (cloned on read; handlers store mutations)
  const livePages = new Map();
  const seedVersions = new Map(); // pathname -> version as seeded at init
  for (const pages of Object.values(sites)) {
    for (const manifest of pages.values()) {
      const path = new URL(manifest.page.url).pathname;
      livePages.set(path, manifest);
      seedVersions.set(path, manifest.page.version);
    }
  }
  const findManifest = (pathname) => livePages.get(pathname) ?? null;
  const storeManifest = (manifest) => livePages.set(new URL(manifest.page.url).pathname, manifest);

  const jobs = new Map(); // jobId -> { pageUrl, polls, finalManifest }
  const challengeStore = new MemoryChallengeStore();
  const consent = { analytics: false, marketing: false };

  // The consent component renders state.consent.value.purposes entries
  // ({id,label,granted,required}); keep them in step with the grants map.
  function syncConsentPurposes(manifest) {
    const purposes = manifest?.state?.consent?.value?.purposes?.value;
    if (!Array.isArray(purposes)) return;
    for (const item of purposes) {
      const id = item?.value?.id?.value ?? item?.id;
      const grantedNode = item?.value?.granted;
      if (id && grantedNode && typeof grantedNode === 'object') {
        grantedNode.value = id === 'necessary' ? true : consent[id] === true;
      }
    }
  }
  const pingBucket = new MemoryRateBucket(2, 5_000, 'lab-ping');
  const sessions = new Set(); // issued session ids (auth: 'session' pages)

  // Delegated auth (docs/specs/SPEC-AUTH.md): demo authorization server.
  // Clients are pre-registered; scopes are allow-lists per client.
  const authSrv = createAuthServer({
    secret: 'demo-auth-secret-do-not-use-in-prod',
    issuer: origin,
    clients: (id) =>
      ({
        'agent-cli': {
          secret: 's3cret-agent',
          scopes: ['read', 'class:safe', 'class:identity'],
        },
        'pay-bot': {
          secret: 's3cret-pay',
          scopes: ['read', 'class:safe', 'class:financial'],
        },
      })[id],
  });

  // OAuth-style token endpoint — accepts urlencoded or JSON.
  app.post('/app-oauth/token', express.text({ type: '*/*' }), async (req, res) => {
    const r = await authSrv.handleTokenRequest(
      typeof req.body === 'object' ? req.body : (req.body ?? ''),
    );
    res
      .status(r.status)
      .type('application/json')
      .setHeader('Cache-Control', 'no-store')
      .json(r.body);
  });
  const sseClients = new Set();
  let eventSeq = 0;
  const eventLog = []; // {id,type,page_id,page_url,version,occurred_at,hint,diff?}

  const str = (value, label) => ({ type: 'string', value, ...(label ? { label } : {}) });

  // diff must be a full Diff Document {app, base:{page_id,page_url,version},
  // result_version, diff:[ops]} — Event Record embeds it per SPEC §14.1 and
  // base_version mirrors base.version at the event level.
  function pushEvent(pageUrl, manifest, diff) {
    const ev = {
      id: `ev_${++eventSeq}`,
      type: 'state.changed',
      page_id: manifest.page.id,
      page_url: pageUrl,
      version: manifest.page.version,
      occurred_at: new Date().toISOString(),
      hint: diff ? 'diff' : 'revalidate',
      ...(diff ? { diff, base_version: diff.base?.version } : {}),
    };
    eventLog.push(ev);
    if (eventLog.length > 200) eventLog.shift();
    const line = `id: ${ev.id}\ndata: ${JSON.stringify({ event: ev })}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(line);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  // negotiated protocol version for envelopes on non-page routes
  const appVer = (req) =>
    String(req.headers['x-app-accept-versions'] ?? req.headers['x-app-version'] ?? '').includes(
      '1.0',
    ) && !String(req.headers['x-app-accept-versions'] ?? '').includes('1.1')
      ? '1.0'
      : '1.1';

  // ---- event channel (SPEC §14): SSE + long-poll ---------------------------
  app.get('/app-events', (req, res) => {
    const ver = appVer(req);
    const accept = String(req.headers.accept ?? '').toLowerCase();
    const mode = String(req.query.mode ?? '');
    const lastId = req.header('Last-Event-ID') ?? req.query.after ?? req.query.last_id ?? '';
    const pending = eventLog.filter((e) => !lastId || e.id > String(lastId));

    if (
      mode === 'longpoll' ||
      (!accept.includes('text/event-stream') && accept !== '*/*' && accept !== '')
    ) {
      if (accept.includes('vnd.agent-page-event') || mode.startsWith('long')) {
        if (pending.length) {
          res
            .status(200)
            .type(MEDIA_PAGE)
            .setHeader(HEADER_APP_RESPONSE_MODE, 'event')
            .setHeader(HEADER_APP_VERSION, ver)
            .json({ app: ver, event: pending[0] });
          return;
        }
        const wait = Math.min(Math.max(Number(req.query.timeout_ms ?? 1000) || 1000, 1000), 30000);
        const timer = setInterval(() => {
          const now = eventLog.filter((e) => !lastId || e.id > String(lastId));
          if (now.length) {
            clearInterval(timer);
            res
              .status(200)
              .type(MEDIA_PAGE)
              .setHeader(HEADER_APP_RESPONSE_MODE, 'event')
              .setHeader(HEADER_APP_VERSION, ver)
              .json({ app: ver, event: now[0] });
          }
        }, 100);
        setTimeout(() => {
          clearInterval(timer);
          if (!res.headersSent) res.status(204).setHeader(HEADER_APP_VERSION, ver).end();
        }, wait);
        req.on('close', () => clearInterval(timer));
        return;
      }
      res
        .status(406)
        .type('application/vnd.agent-page-error+json')
        .json({
          app: ver,
          error: {
            code: 'app.err.negotiate.not_acceptable',
            message: 'SSE requires text/event-stream',
            retryable: false,
            http_status: 406,
          },
        });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', MEDIA_EVENT_STREAM);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(HEADER_APP_VERSION, ver);
    res.setHeader(HEADER_APP_RESPONSE_MODE, 'event');
    res.flushHeaders?.();
    res.write(
      `id: ev_0\ndata: ${JSON.stringify({ event: { id: 'ev_0', type: 'heartbeat', page_id: '-', page_url: `${origin}/`, version: '-', occurred_at: new Date().toISOString(), hint: 'revalidate' } })}\n\n`,
    );
    for (const ev of pending) {
      res.write(`id: ${ev.id}\ndata: ${JSON.stringify({ event: ev })}\n\n`);
    }
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // ---- async job status -----------------------------------------------------
  app.get('/operations/:jobId', (req, res) => {
    log(`operations poll ${req.params.jobId}`);
    const job = jobs.get(req.params.jobId);
    const ver = appVer(req);
    if (!job) {
      res
        .status(404)
        .type('application/vnd.agent-page-error+json')
        .json({
          app: ver,
          error: {
            code: 'app.err.page.not_found',
            message: 'Operation not found',
            retryable: false,
            http_status: 404,
          },
        });
      return;
    }
    job.polls += 1;
    if (job.polls < 2) {
      const pending = {
        app: ver,
        page: { ...job.page, id: 'operation_status', title: 'Operation status' },
        state: {
          operation_status: obj({
            job_id: str(req.params.jobId),
            state: str('running'),
            progress: num(50),
          }),
        },
        actions: {},
        meta: { poll_interval_ms: 400 },
      };
      res.status(202).type(MEDIA_PAGE).setHeader(HEADER_APP_RESPONSE_MODE, 'async').json(pending);
      return;
    }
    job.finalManifest.state.status.value = 'done';
    storeManifest(job.finalManifest);
    res
      .status(200)
      .type(MEDIA_PAGE)
      .setHeader(HEADER_APP_RESPONSE_MODE, 'full')
      .json(job.finalManifest);
  });

  // ---- action handlers ------------------------------------------------------
  const labHandlers = {
    // counter: real state mutation -> diff + event
    inc: async (ctx) => {
      const prevVersion = ctx.manifest.page.version;
      const next = structuredClone(ctx.manifest);
      next.state.counter.value += Number(ctx.params.delta ?? 1);
      next.page.version = bump(next.page.version);
      storeManifest(next);
      pushEvent(next.page.url, next, {
        app: '1.1',
        base: { page_id: next.page.id, page_url: next.page.url, version: prevVersion },
        result_version: next.page.version,
        diff: [{ op: 'replace', path: '/state/counter/value', value: next.state.counter.value }],
      });
      return { type: 'diff', nextManifest: next };
    },

    // playground: echo received params into state.last_echo
    inspect_params: async (ctx) => {
      const next = structuredClone(ctx.manifest);
      const echo = { type: 'object', value: {}, label: 'Last request' };
      for (const [k, v] of Object.entries(ctx.params)) {
        echo.value[k] = {
          type: 'string',
          value: typeof v === 'object' ? JSON.stringify(v) : String(v),
          label: k,
        };
      }
      next.state.last_echo = echo;
      next.page.version = bump(next.page.version);
      storeManifest(next);
      pushEvent(next.page.url, next, null);
      return { type: 'full', manifest: next };
    },

    // async: 202 then status_url flips to succeeded
    start_job: async (ctx) => {
      const jobId = `job_${randomBytes(4).toString('hex')}`;
      const finalManifest = structuredClone(ctx.manifest);
      finalManifest.page.version = bump(finalManifest.page.version);
      jobs.set(jobId, { page: ctx.manifest.page, polls: 0, finalManifest });
      return {
        type: 'async',
        jobId,
        pollIntervalMs: 400,
        statusUrl: `${origin}/operations/${jobId}`,
      };
    },

    // OTP challenge (SPEC §18.2 inline continuation):
    //   first call -> 428 challenge_required (middleware binds idem key)
    //   retry with X-APP-Challenge + params.otp -> verify + session cookie
    login: async (ctx) => {
      const chHeader = ctx.headers['x-app-challenge'];
      if (typeof chHeader === 'string' && chHeader) {
        const result = await verifyOtp(challengeStore, {
          id: chHeader,
          otp: String(ctx.params.otp ?? ''),
        });
        if (!result.ok)
          throw new AppError(result.error.envelope.error.code, {
            message: result.error.envelope.error.message,
            details: result.error.envelope.error.details,
          });
        await spendChallenge(challengeStore, chHeader);
        const sessionId = `lab_${randomBytes(4).toString('hex')}`;
        sessions.add(sessionId);
        const next = structuredClone(ctx.manifest);
        next.state.status.value = `signed-in as ${ctx.params.user ?? 'demo'}`;
        next.state.session_token = str(
          sessionId,
          'Session token (demo — pass as Authorization: Bearer)',
        );
        next.page.version = bump(next.page.version);
        storeManifest(next);
        return { type: 'full', manifest: next };
      }
      const rec = await issueOtpChallenge(challengeStore, { otp: LAB_OTP });
      const chObj = challengeToObject(rec);
      throw new AppError('app.err.auth.challenge_required', {
        message: 'Enter the 6-digit code (demo OTP: 123456)',
        details: {
          challenge: {
            type: 'object',
            label: 'Challenge',
            value: {
              id: str(chObj.id),
              kind: {
                type: 'enum',
                value: chObj.kind,
                options: [
                  'otp',
                  'totp',
                  'webauthn',
                  'magic_link',
                  'password',
                  'backup_code',
                  'push',
                ],
              },
              param: str('otp'),
              ...(chObj.channel
                ? {
                    channel: {
                      type: 'enum',
                      value: chObj.channel,
                      options: [
                        'sms',
                        'email',
                        'totp',
                        'authenticator_push',
                        'passkey',
                        'backup_code',
                        'voice',
                      ],
                    },
                  }
                : {}),
              ttl_ms: { type: 'number', value: chObj.ttl_ms },
              attempts_remaining: { type: 'number', value: chObj.attempts_remaining },
              max_attempts: { type: 'number', value: chObj.max_attempts },
              expires_at: { type: 'datetime', value: chObj.expires_at },
            },
          },
        },
      });
    },

    whoami: async (ctx) => {
      const auth = ctx.headers.authorization ?? ctx.headers.cookie ?? '';
      const ok = [...sessions].some((sid) => String(auth).includes(sid)) || String(auth).length > 0;
      if (!ok) {
        throw new AppError('app.err.auth.required', { message: 'Sign in first' });
      }
      const next = structuredClone(ctx.manifest);
      next.state.status.value = `authenticated (${String(auth).slice(0, 40)})`;
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    logout: async (ctx) => {
      const auth = ctx.headers.authorization ?? ctx.headers.cookie ?? '';
      for (const sid of [...sessions]) {
        if (String(auth).includes(sid)) sessions.delete(sid);
      }
      const next = structuredClone(ctx.manifest);
      next.state.status.value = 'signed-out';
      delete next.state.session_token;
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // consent gate
    track: async (ctx) => {
      if (!consent.analytics) {
        throw new AppError('app.err.consent.required', {
          message: 'Analytics consent required',
          details: { missing: { type: 'array', value: [str('analytics')] } },
        });
      }
      const next = structuredClone(ctx.manifest);
      next.state.tracked.value += 1;
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    grant_consent: async (ctx) => {
      // purposes: string[] (agents) or {id,granted}[] (extension consent UI)
      for (const p of Array.isArray(ctx.params.purposes) ? ctx.params.purposes : ['analytics']) {
        const id = typeof p === 'object' && p ? p.id : p;
        const granted = typeof p === 'object' && p ? p.granted !== false : true;
        if (id in consent) consent[id] = granted;
      }
      const next = structuredClone(ctx.manifest);
      syncConsentPurposes(next);
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    revoke_consent: async (ctx) => {
      for (const p of Array.isArray(ctx.params.purposes) ? ctx.params.purposes : []) {
        const id = typeof p === 'object' && p ? p.id : p;
        if (id in consent && id !== 'necessary') consent[id] = false;
      }
      const next = structuredClone(ctx.manifest);
      syncConsentPurposes(next);
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // rate limit (2 per 5s)
    ping: async (ctx) => {
      const key = ctx.sessionId ?? 'anon';
      const r = pingBucket.consume(key);
      if (!r.allowed) {
        throw new AppError('app.err.rate.limited', {
          message: 'Rate limit exceeded',
          retryable: true,
          retry_after_ms: r.retryAfterMs,
        });
      }
      const next = structuredClone(ctx.manifest);
      next.state.pings.value += 1;
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // idempotent payment — middleware replays same-key POSTs automatically
    pay: async (ctx) => {
      const next = structuredClone(ctx.manifest);
      next.state.payments.value += 1;
      next.state.last_amount = {
        type: 'number',
        value: Number(ctx.params.amount),
        unit: 'GBP',
        scale: 2,
        label: 'Last amount',
      };
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // soft-error retry clears page.error
    retry: async (ctx) => {
      const next = structuredClone(ctx.manifest);
      delete next.error;
      next.state.feed.value = 'fully loaded';
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // typeahead: results into state.results (table node per options_source)
    suggest: async (ctx) => {
      const q = String(ctx.params.q ?? '').toLowerCase();
      const cities = [
        ['lhr', 'London Heathrow'],
        ['lgw', 'London Gatwick'],
        ['jfk', 'New York JFK'],
        ['bos', 'Boston Logan'],
        ['dxb', 'Dubai Intl'],
        ['sin', 'Singapore Changi'],
      ];
      const rows = cities.filter(([, name]) => name.toLowerCase().includes(q));
      const next = structuredClone(ctx.manifest);
      next.state.results = {
        type: 'table',
        label: 'Suggestions',
        fields: { code: 'string', name: 'string' },
        value: rows,
      };
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    pick_city: async (ctx) => {
      const next = structuredClone(ctx.manifest);
      next.state.picked = str(String(ctx.params.city), 'Picked city');
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // delegate: the renderer opens delegates_to for the human (new tab) — the
    // POST itself must NOT navigate off-origin (psp.example.com is unreachable;
    // a 303 there surfaces as a transport error). Bind the handoff in state and
    // let the agent/human resume via resume_url.
    pay_external: async (ctx) => {
      const next = structuredClone(ctx.manifest);
      next.state.status = {
        type: 'string',
        value: `handed off to psp.example.com for £${ctx.params.amount ?? '?'} — resume at /app/lab/delegate-done`,
        label: 'Status',
      };
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // bulk: tag items via runBulk helper
    bulk_tag: async (ctx) => {
      const check = validateBulkItems(ctx.params.items, {
        featureEnabled: true,
        actionDef: ctx.actionDef,
      });
      if (!check.ok) {
        throw new AppError(check.error.code, {
          message: check.error.message,
          path: check.error.path,
        });
      }
      const tag = String(ctx.params.tag ?? 'starred');
      const next = structuredClone(ctx.manifest);
      const table = next.state.items;
      const outcome = await runBulk({
        mode: check.mode,
        items: check.items,
        runOne: (id) => {
          const row = table.value.find((r) => r[0] === id);
          if (!row) return { id: String(id), ok: false, code: 'unknown_item' };
          row[1] = tag;
          return { id: String(id), ok: true, code: 'ok' };
        },
      });
      if (!outcome.ok && check.mode === 'all_or_nothing') {
        throw new AppError('app.err.validation.param_value', {
          message: `bulk failed for: ${outcome.results
            .filter((r) => !r.ok)
            .map((r) => r.id)
            .join(', ')}`,
        });
      }
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'diff', nextManifest: next };
    },

    // delegated auth lab — the authorize hook already enforced bearer scope
    delegated_status: async (ctx, label, scope) => {
      const next = structuredClone(ctx.manifest);
      next.state.status.value = label;
      next.state.last_scope.value = scope;
      next.page.version = bump(next.page.version);
      storeManifest(next);
      return { type: 'full', manifest: next };
    },
    read_status: async (ctx) => labHandlers.delegated_status(ctx, 'read ok', 'read'),
    touch: async (ctx) => labHandlers.delegated_status(ctx, 'touched', 'class:safe'),
    charge: async (ctx) => labHandlers.delegated_status(ctx, 'charged', 'class:financial'),
  };

  // ---- Multiversal Airways handlers (real state mutations) ----------------
  const mvaHandlers = makeMvaHandlers({ origin, bump, storeManifest, pushEvent, AppError });
  const gcHandlers = makeGcHandlers({ bump, storeManifest, pushEvent, AppError });

  // ---- Halvern House hotel handlers (real state mutations) ----------------
  const hotelHandlers = makeHotelHandlers({
    origin,
    bump,
    storeManifest,
    pushEvent,
    AppError,
  });

  // Generic resolver for every action id on any demo site. Lab + mva ids get
  // bespoke handlers; everything else follows output.navigates_to or echoes
  // the page (state mutation only happens where a handler stores it).
  const demoDispatch = async (ctx) => {
    const isLab = ctx.manifest.page.url.includes('/app/lab/');
    if (isLab) {
      const h = labHandlers[ctx.actionId];
      if (h) return h(ctx);
    }
    const isMva = ctx.manifest.page.url.includes('/app/mva/');
    if (isMva) {
      const h = mvaHandlers[ctx.actionId];
      if (h) return h(ctx);
    }
    const isGc = ctx.manifest.page.url.includes('/app/gc/');
    if (isGc) {
      const h = gcHandlers[ctx.actionId];
      if (h) return h(ctx);
    }
    const isHotel = ctx.manifest.page.url.includes('/app/hotel/');
    if (isHotel) {
      const h = hotelHandlers[ctx.actionId];
      if (h) return h(ctx);
    }
    const def = ctx.manifest.actions?.[ctx.actionId];
    const nav = def?.output?.navigates_to;
    if (nav) {
      const url = new URL(nav, ctx.manifest.page.url);
      if (url.origin !== new URL(ctx.manifest.page.url).origin) {
        return { type: 'navigate', url: url.href, mode: 'push' };
      }
      return { type: 'navigate', url: url.href, mode: 'push' };
    }
    return { type: 'full', manifest: structuredClone(ctx.manifest) };
  };

  const actionHandlers = {};
  for (const pages of Object.values(sites)) {
    for (const manifest of pages.values()) {
      for (const id of Object.keys(manifest.actions ?? {})) {
        actionHandlers[id] = demoDispatch;
      }
    }
  }

  // Delegated-auth approval actions (live on the generated authorize page).
  actionHandlers.authorize = async (ctx) => {
    const p = ctx.manifest.state?.authz_params?.value ?? {};
    const get = (k) => p[k]?.value ?? '';
    const code = authSrv.mintCode({
      client_id: get('client_id'),
      redirect_uri: get('redirect_uri'),
      scope: get('scope'),
      code_challenge: get('code_challenge'),
    });
    const url = new URL(get('redirect_uri'));
    url.searchParams.set('code', code);
    if (get('state')) url.searchParams.set('state', get('state'));
    return { type: 'navigate', url: url.toString(), mode: 'push' };
  };
  actionHandlers.deny = async (ctx) => {
    const p = ctx.manifest.state?.authz_params?.value ?? {};
    const get = (k) => p[k]?.value ?? '';
    const url = new URL(get('redirect_uri'));
    url.searchParams.set('error', 'access_denied');
    if (get('state')) url.searchParams.set('state', get('state'));
    return { type: 'navigate', url: url.toString(), mode: 'push' };
  };

  // GET/POST catch-all for demo pages (registered last — /app-events and
  // /operations/:jobId above keep their own routes).
  const pageHandler = createPageHandler({
    pageOrigin: origin,
    asyncJobStore: new MemoryAsyncJobStore(),
    getSessionId: (req) => {
      const cookie = req.headers.cookie ?? '';
      const m = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
      if (m?.[1]) return m[1];
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth) return `bearer:${auth.slice(0, 24)}`;
      return 'anon';
    },
    getManifest: async ({ url }) => {
      const u = new URL(url, origin);
      // Delegated auth approval page (SPEC-AUTH §4.2) — the authorization
      // endpoint is itself a Page Manifest; generated per-request.
      if (u.pathname === '/app/oauth/authorize') {
        return authSrv.authorizeManifest({
          client_id: u.searchParams.get('client_id') ?? '',
          redirect_uri: u.searchParams.get('redirect_uri') ?? '',
          scope: u.searchParams.get('scope') ?? 'read',
          state: u.searchParams.get('state') ?? '',
          code_challenge: u.searchParams.get('code_challenge') ?? '',
          authorization_url: `${origin}/app/oauth/authorize`,
        });
      }
      const manifest = findManifest(u.pathname);
      if (!manifest) return null;
      return structuredClone(manifest);
    },
    actionHandlers,
    // Bearer actions get real scoped-token verification (SPEC-AUTH §6);
    // other auth modes keep their presence check.
    authorize: async (req, actionId, actionDef) => {
      if (actionDef?.auth === 'bearer') return authSrv.authorize(req, actionId, actionDef);
      if (actionDef?.auth && actionDef.auth !== 'none') {
        const has = req.headers.authorization || req.headers.cookie;
        return has
          ? { ok: true }
          : { ok: false, code: 'app.err.auth.required', message: 'Credentials required' };
      }
      return { ok: true };
    },
  });

  // Cold-instance self-heal: a fresh serverless instance re-seeds every world,
  // so a client that pinned a version a dead instance produced would 409 on
  // every subsequent If-Match action forever. While a manifest is still at its
  // seed version on this instance (unmutated), a mismatch can only mean the
  // client came from a different universe — retarget the pinned version to the
  // current one so the action applies to the seeded world (wire clients send
  // X-APP-If-Match-Version; /site/ form posts carry __version, which the site
  // bridge turns into that header). Once the world has been mutated past
  // seed, a mismatch is a real concurrent-write conflict and the middleware
  // keeps its 409. Real deployments should use a shared store.
  app.use((req, res, next) => {
    if (req.method !== 'POST' || !req.path.startsWith('/app/')) return next();
    const sent = req.headers['x-app-if-match-version'];
    const manifest = sent == null ? null : findManifest(req.path);
    const serverVersion = manifest?.page?.version;
    if (serverVersion && serverVersion !== sent && serverVersion === seedVersions.get(req.path)) {
      req.headers['x-app-if-match-version'] = serverVersion;
    }
    next();
  });

  // ---- /site/<site>/<slug> — negotiated hybrid surface --------------------
  // Same manifests as /app/*: Accept negotiates manifest vs generated HTML;
  // form POSTs bridge to the real wire middleware (see lib/site-routes.mjs).
  mountSiteRoutes(app, {
    origin,
    skins,
    findManifest,
    pageHandler,
    express,
    seedVersionOf: (pathname) => seedVersions.get(pathname),
  });

  // Browser-session bridge: a login response carries state.session_token —
  // surface it as a `session=` cookie so the extension's credentialed fetch
  // authenticates subsequent auth:'session' actions (agents use Bearer).
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path.startsWith('/app/')) {
      const origJson = res.json.bind(res);
      res.json = (body) => {
        const tok = body?.state?.session_token?.value;
        if (typeof tok === 'string' && tok) {
          res.setHeader('Set-Cookie', `session=${tok}; Path=/; HttpOnly; SameSite=Strict`);
        }
        return origJson(body);
      };
    }
    next();
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/app/')) return pageHandler(req, res, next);
    next();
  });
  app.use(appBodyErrorHandler);

  log('full', 'mounted @agent-page/server middleware for /app/*');
  return app;
}

function obj(value, label) {
  return { type: 'object', value, ...(label ? { label } : {}) };
}

function num(v) {
  return { type: 'number', value: v };
}
