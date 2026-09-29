/**
 * ToolRuntime - createRuntime API (CLIENT-TOOL-CONTRACT §11.2).
 * Local adapter until @agent-page/tool-core lands; switch imports then.
 */

import {
  AgentClient,
  AppError,
  extractOrigin,
  isLoopbackHost,
  normalizeAppUrl,
  resolveAppUrl,
  type ActionDef,
  type FetchLike,
  type InvokeResult,
  type PageManifest,
} from '@agent-page/client';
import { digest, stateDelta } from './digest.js';
import { buildEnvelope, errorEnvelope, HoldSignal } from './envelope.js';
import { CredentialResolver } from './credentials.js';
import {
  capabilitiesFromWellKnown,
  entryUrlsFromWellKnown,
  featuresFromWellKnown,
  normalizeAuth,
  siteNameFromWellKnown,
} from './capabilities.js';
import { HoldStore, decodeRawBody, publicHoldFromFile, resumeHintFor } from './holds.js';
import {
  SessionStore,
  SessionStoreError,
  defaultHome,
  generateSessionId,
} from './session-store.js';
import type {
  ActResult,
  Hold,
  PageDigest,
  SessionFile,
  SessionSummary,
  ToolEnvelope,
} from './types.js';

export interface CreateRuntimeOptions {
  home?: string;
  fetch?: FetchLike;
  clientName?: string;
  clientVersion?: string;
  bearerEnv?: string;
  apiKeyEnv?: string;
  cookieJar?: string;
  topK?: number;
  timeoutMs?: number;
  policyStrict?: boolean;
  asyncWait?: boolean;
  full?: boolean;
  raw?: boolean;
  acceptVersions?: string;
  session?: string;
  failOnSoft?: boolean;
}

export interface ActOptions {
  params?: Record<string, unknown>;
  confirmation?: string;
  idempotencyKey?: string;
  noWait?: boolean;
  noFollow?: boolean;
  noConflictRetry?: boolean;
  files?: Record<string, string>;
}

export interface ToolRuntime {
  client: AgentClient;
  store: SessionStore;
  credentials: CredentialResolver;
  holds: HoldStore;
  opts: Required<
    Pick<
      CreateRuntimeOptions,
      | 'topK'
      | 'timeoutMs'
      | 'policyStrict'
      | 'asyncWait'
      | 'full'
      | 'raw'
      | 'clientName'
      | 'clientVersion'
    >
  > &
    CreateRuntimeOptions;

  digest: typeof digest;
  open: (
    url: string,
    opts?: {
      discover?: boolean;
      sessionId?: string;
      title?: string;
      force?: boolean;
    },
  ) => Promise<ToolEnvelope>;
  act: (action: string, opts?: ActOptions) => Promise<ToolEnvelope>;
  confirm: (opts: {
    approve?: boolean;
    reject?: boolean;
    token?: string;
    noWait?: boolean;
  }) => Promise<ToolEnvelope>;
  challenge: (opts: {
    op: 'submit' | 'abort';
    kind?: string;
    value?: string;
  }) => Promise<ToolEnvelope>;
  watch: (opts?: {
    once?: boolean;
    intervalMs?: number;
    maxEvents?: number;
    timeoutMs?: number;
    sse?: boolean;
  }) => Promise<ToolEnvelope>;
  sessions: (op: string, id?: string) => Promise<ToolEnvelope>;
  logout: (origin?: string, all?: boolean) => Promise<ToolEnvelope>;
  reset: (opts?: { all?: boolean; session?: string }) => Promise<ToolEnvelope>;
  state: (opts?: { path?: string; full?: boolean }) => Promise<ToolEnvelope>;
  actions: () => Promise<ToolEnvelope>;
  navigate: (url: string) => Promise<ToolEnvelope>;
  discover: (originOrUrl: string) => Promise<ToolEnvelope>;
  getCurrentSessionId: () => string | null;
}

interface LastPostCapture {
  rawBody?: string;
  postUrl?: string;
  idempotencyKey?: string;
  ifMatchVersion?: string;
}

export function createRuntime(options: CreateRuntimeOptions = {}): ToolRuntime {
  const store = new SessionStore(options.home ?? defaultHome(), {
    sessionTtlMs: 86_400_000,
  });
  store.ensureHome();
  try {
    store.gc();
  } catch {
    /* best-effort */
  }

  const credentials = new CredentialResolver({
    bearerEnv: options.bearerEnv,
    apiKeyEnv: options.apiKeyEnv,
    cookieJar: options.cookieJar,
  });
  const holds = new HoldStore(store);

  const wellKnownByOrigin = new Map<string, PageManifest>();
  const manifestsBySession = new Map<string, PageManifest>();
  const lastPost: LastPostCapture = {};

  const clientName = options.clientName ?? 'agent-page-cli';
  const clientVersion = options.clientVersion ?? '0.5.0';
  const topK = options.topK ?? 8;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const policyStrict = options.policyStrict ?? false;
  const asyncWait = options.asyncWait ?? true;
  const full = options.full ?? false;
  const raw = options.raw ?? false;

  const client = new AgentClient({
    fetch: options.fetch,
    clientName,
    clientVersion,
    getAuthHeaders: () => credentials.getAuthHeaders(),
    onConfirm: async (req) => {
      // Never auto-approve. Persist hold + throw HoldSignal (D-4 / §11.2).
      const sessionId = runtime.getCurrentSessionId();
      if (!sessionId) {
        throw new AppError('app.err.tool.session_missing', {
          message: 'No session for confirmation hold',
        });
      }
      const session = store.readSession(sessionId);
      const manifest = req.manifest;
      const rawBody =
        lastPost.rawBody ??
        JSON.stringify({
          app: '1.0',
          action: req.actionId,
          params: req.params,
          client: { kind: 'agent', name: clientName, version: clientVersion },
          context: {
            page_id: manifest.page.id,
            page_url: manifest.page.url,
            manifest_version: manifest.page.version,
          },
        });
      const postUrl =
        lastPost.postUrl ??
        resolveAppUrl(req.actionDef.action_url || manifest.page.url, manifest.page.url);

      const challenge = req.challenge ?? null;
      if (challenge?.startsWith('uuid-mode:')) {
        throw new AppError('app.err.action.confirmation_invalid', {
          message: 'Agents must not use Mode B uuid-mode confirmation',
        });
      }

      const file = holds.persist(sessionId, {
        kind: 'confirmation',
        action: req.actionId,
        page_url: manifest.page.url,
        page_version: manifest.page.version,
        post_url: postUrl,
        challenge,
        idempotency_key: lastPost.idempotencyKey ?? null,
        if_match_version: lastPost.ifMatchVersion ?? manifest.page.version,
        raw_body: rawBody,
        level: req.level,
        side_effect: req.actionDef.side_effect ?? 'safe',
        amount: req.amount
          ? {
              value: req.amount.value,
              unit: req.amount.unit,
              scale: req.amount.scale,
              path: req.amount.path,
            }
          : null,
        title: req.actionDef.confirm?.title ?? 'Confirm',
        body: formatConfirmBody(req),
        origin: session.origin,
        pii_params:
          (req.actionDef.policy as { pii_params?: string[] } | undefined)?.pii_params ?? [],
      });

      const hold = publicHoldFromFile(file);
      throw new HoldSignal(
        buildEnvelope('hold', {
          session: sessionId,
          page: {
            id: manifest.page.id,
            url: manifest.page.url,
            version: manifest.page.version,
            title: manifest.page.title,
          },
          hold,
          meta: { warnings: [], negotiated_version: session.protocol_version },
        }),
      );
    },
    onChallenge: async (req) => {
      // Persist challenge hold + throw HoldSignal (mirrors onConfirm; §18.2).
      const sessionId = runtime.getCurrentSessionId();
      if (!sessionId) {
        throw new AppError('app.err.tool.session_missing', {
          message: 'No session for challenge hold',
        });
      }
      const session = store.readSession(sessionId);
      const manifest = req.manifest;
      const rawBody =
        lastPost.rawBody ??
        JSON.stringify({
          app: '1.0',
          action: req.actionId,
          params: req.params,
          client: { kind: 'agent', name: clientName, version: clientVersion },
          context: {
            page_id: manifest.page.id,
            page_url: manifest.page.url,
            manifest_version: manifest.page.version,
          },
        });
      const actionUrl = manifest.actions?.[req.actionId]?.action_url ?? manifest.page.url;
      const postUrl = lastPost.postUrl ?? resolveAppUrl(actionUrl, manifest.page.url);
      const kind =
        req.challenge.kind === 'webauthn' || req.challenge.kind === 'backup_code' ? 'mfa' : 'otp';
      const file = holds.persist(sessionId, {
        kind,
        action: req.actionId,
        page_url: manifest.page.url,
        page_version: manifest.page.version,
        post_url: postUrl,
        challenge: req.challenge.id,
        challenge_param: req.challenge.param ?? 'otp',
        idempotency_key: lastPost.idempotencyKey ?? null,
        if_match_version: lastPost.ifMatchVersion ?? manifest.page.version,
        raw_body: rawBody,
        side_effect: manifest.actions?.[req.actionId]?.side_effect ?? 'safe',
        title: `Verification (${req.challenge.kind})`,
        origin: session.origin,
        expires_at: req.challenge.expires_at,
      });
      throw new HoldSignal(
        buildEnvelope('hold', {
          session: sessionId,
          page: {
            id: manifest.page.id,
            url: manifest.page.url,
            version: manifest.page.version,
            title: manifest.page.title,
          },
          hold: publicHoldFromFile(file),
          meta: { warnings: [], negotiated_version: session.protocol_version },
        }),
      );
    },
  });

  // Capture raw body bytes from postAction for Mode A persistence
  const originalPost = client.http.postAction.bind(client.http);
  client.http.postAction = async (url, body, opts) => {
    const result = await originalPost(url, body, opts);
    lastPost.rawBody = result.rawBody;
    lastPost.postUrl = url;
    lastPost.idempotencyKey = opts.idempotencyKey;
    lastPost.ifMatchVersion = opts.ifMatchVersion;
    return result;
  };

  const capsFor = (origin: string) => {
    const wk = wellKnownByOrigin.get(origin);
    return {
      capabilities: capabilitiesFromWellKnown(wk),
      features: featuresFromWellKnown(wk),
    };
  };

  const makeDigest = (manifest: PageManifest, origin: string): PageDigest => {
    const { capabilities, features } = capsFor(origin);
    return digest(manifest, { topK, capabilities, features, full, raw });
  };

  const requireSession = (): { id: string; session: SessionFile; manifest: PageManifest } => {
    const id = runtime.getCurrentSessionId();
    if (!id) {
      throw toolErr('app.err.tool.session_missing', 'No current session');
    }
    let session: SessionFile;
    try {
      session = store.readSession(id);
    } catch (e) {
      if (e instanceof SessionStoreError) throw toolErr(e.code, e.message);
      throw e;
    }
    if (!session.current) {
      throw toolErr('app.err.tool.session_missing', 'Session has no current page');
    }
    let manifest = manifestsBySession.get(id);
    if (!manifest) {
      const cached = store.readPublicCache(session.current.url);
      if (cached?.manifest) {
        manifest = cached.manifest as PageManifest;
        manifestsBySession.set(id, manifest);
      }
    }
    if (!manifest) {
      throw toolErr('app.err.tool.session_missing', 'No cached manifest; run open first');
    }
    return { id, session, manifest };
  };

  const touchSession = (
    session: SessionFile,
    manifest: PageManifest,
    extra?: Partial<SessionFile>,
  ): SessionFile => {
    const now = new Date().toISOString();
    const next: SessionFile = {
      ...session,
      ...extra,
      updated_at: now,
      last_used_at: now,
      current: {
        page_id: manifest.page.id,
        url: manifest.page.url,
        version: manifest.page.version,
        etag: manifest.page.etag ?? null,
        title: manifest.page.title ?? null,
      },
    };
    if (!next.stack.includes(manifest.page.url)) {
      next.stack = [...next.stack, manifest.page.url];
    }
    store.writeSession(next);
    manifestsBySession.set(session.id, manifest);
    try {
      store.writePublicCache(manifest.page.url, {
        etag: manifest.page.etag ?? null,
        version: manifest.page.version,
        ttl_ms: 60_000,
        manifest,
      });
    } catch {
      /* ignore */
    }
    return next;
  };

  const runtime: ToolRuntime = {
    client,
    store,
    credentials,
    holds,
    opts: {
      ...options,
      topK,
      timeoutMs,
      policyStrict,
      asyncWait,
      full,
      raw,
      clientName,
      clientVersion,
    },
    digest,

    getCurrentSessionId(): string | null {
      return store.currentSessionId(options.session);
    },

    async discover(originOrUrl: string): Promise<ToolEnvelope> {
      let origin: string;
      try {
        const u = new URL(originOrUrl.includes('://') ? originOrUrl : `https://${originOrUrl}`);
        origin = extractOrigin(u.href);
      } catch {
        return errorEnvelope('app.err.navigation.invalid_url', 'Invalid URL', {
          session: null,
        });
      }
      const wellKnownUrl = `${origin}/.well-known/agent-page`;
      try {
        const manifest = await client.hydrate(wellKnownUrl, { force: true, bypassCache: true });
        wellKnownByOrigin.set(origin, manifest);
        return buildEnvelope('ok', {
          session: null,
          discovery: {
            origin,
            well_known_url: wellKnownUrl,
            supported: true,
            site_name: siteNameFromWellKnown(manifest),
            protocol_version: (manifest.app as string) ?? '1.0',
            capabilities: capabilitiesFromWellKnown(manifest),
            entry_urls: entryUrlsFromWellKnown(manifest),
          },
          meta: {
            warnings: [],
            negotiated_version: String(manifest.app ?? '1.0'),
          },
        });
      } catch (e) {
        const code = e instanceof AppError ? e.code : 'app.err.discovery.not_supported';
        return errorEnvelope(
          code === 'app.err.page.not_found' ? 'app.err.discovery.not_supported' : code,
          e instanceof Error ? e.message : 'Discovery failed',
          { session: null, http_status: e instanceof AppError ? e.httpStatus : null },
        );
      }
    },

    async open(url: string, opts = {}): Promise<ToolEnvelope> {
      const started = Date.now();
      let absolute: string;
      try {
        absolute = normalizeAppUrl(url.includes('://') ? url : `https://${url}`);
      } catch {
        return errorEnvelope('app.err.navigation.invalid_url', 'Invalid URL');
      }
      try {
        const parsed = new URL(absolute);
        if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
          return errorEnvelope('app.err.security.tls', 'Non-loopback HTTP is not allowed');
        }
      } catch {
        return errorEnvelope('app.err.navigation.invalid_url', 'Invalid URL');
      }

      const origin = extractOrigin(absolute);
      const doDiscover = opts.discover !== false;
      const warnings: string[] = [];

      if (doDiscover && !wellKnownByOrigin.has(origin)) {
        try {
          const wk = await client.hydrate(`${origin}/.well-known/agent-page`, {
            force: true,
            bypassCache: true,
          });
          wellKnownByOrigin.set(origin, wk);
        } catch {
          warnings.push('app.err.discovery.not_supported');
        }
      }

      const existingId = runtime.getCurrentSessionId();
      let session: SessionFile | null = null;
      if (existingId) {
        try {
          const s = store.readSession(existingId);
          if (s.origin === origin) session = s;
          else if (options.session && options.session === existingId) {
            return errorEnvelope(
              'app.err.tool.session_origin_mismatch',
              'Session origin does not match URL origin',
              { session: existingId },
            );
          }
        } catch {
          /* create new */
        }
      }

      const now = new Date().toISOString();
      if (!session) {
        const id =
          opts.sessionId && /^ses_[A-Za-z0-9_-]{8,128}$/.test(opts.sessionId)
            ? opts.sessionId
            : generateSessionId();
        const wk = wellKnownByOrigin.get(origin);
        session = {
          schema: 'agent-page.session/1.0',
          id,
          created_at: now,
          updated_at: now,
          last_used_at: now,
          origin,
          title: opts.title ?? siteNameFromWellKnown(wk) ?? null,
          protocol_version: '1.0',
          accepted_versions: (options.acceptVersions ?? '1.1, 1.0')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          capabilities: capabilitiesFromWellKnown(wk),
          auth: { mode: 'none', env_ref: null, cookie_jar: options.cookieJar ?? null },
          resume: { present: false, expires_at: null },
          current: null,
          stack: [],
          last_action: null,
          watch: { last_event_id: null, subscribed: false },
          cache_policy: 'public_only',
          flags: { v05_features: false, strict: false },
        };
      }

      let cacheMeta: 'hit' | 'revalidated' | 'miss' | 'bypass';
      if (!opts.force) {
        const cached = store.readPublicCache(absolute);
        if (cached && Date.now() - cached.fetched_at < cached.ttl_ms) {
          const manifest = cached.manifest as PageManifest;
          session = touchSession(session, manifest);
          cacheMeta = 'hit';
          return buildEnvelope('ok', {
            session: session.id,
            page: {
              id: manifest.page.id,
              url: manifest.page.url,
              version: manifest.page.version,
              title: manifest.page.title,
              etag: manifest.page.etag,
              description: manifest.page.description,
            },
            digest: makeDigest(manifest, origin),
            meta: {
              warnings,
              duration_ms: Date.now() - started,
              cache: cacheMeta,
              negotiated_version: session.protocol_version,
              truncated: false,
            },
          });
        }
      }

      const manifest = await client.hydrate(absolute, {
        force: opts.force ?? false,
      });
      cacheMeta = 'miss';
      session = touchSession(session, manifest, {
        title: session.title ?? opts.title ?? manifest.page.title ?? null,
      });

      return buildEnvelope('ok', {
        session: session.id,
        page: {
          id: manifest.page.id,
          url: manifest.page.url,
          version: manifest.page.version,
          title: manifest.page.title,
          etag: manifest.page.etag,
          description: manifest.page.description,
        },
        digest: makeDigest(manifest, origin),
        meta: {
          warnings,
          duration_ms: Date.now() - started,
          cache: cacheMeta,
          negotiated_version: session.protocol_version,
          truncated: makeDigest(manifest, origin).truncated,
        },
      });
    },

    async act(action: string, actOpts: ActOptions = {}): Promise<ToolEnvelope> {
      const started = Date.now();
      let ctx: { id: string; session: SessionFile; manifest: PageManifest };
      try {
        ctx = requireSession();
      } catch (e) {
        if (e instanceof ToolLocalError) {
          return errorEnvelope(e.code, e.message, { session: runtime.getCurrentSessionId() });
        }
        throw e;
      }

      if (actOpts.confirmation?.startsWith('uuid-mode:')) {
        return errorEnvelope(
          'app.err.action.confirmation_invalid',
          'Agents must not use Mode B uuid-mode confirmation',
          { session: ctx.id },
        );
      }

      const actionDef = ctx.manifest.actions?.[action];
      if (!actionDef) {
        return errorEnvelope('app.err.action.not_found', `Action not found: ${action}`, {
          session: ctx.id,
        });
      }

      const auth = normalizeAuth(actionDef.auth);
      if (auth === 'user') {
        // Hold auth without POSTing (SPEC §6.10 / contract §7.4)
        const hold: Hold = {
          kind: 'auth',
          preflight: true,
          action,
          page_url: ctx.manifest.page.url,
          page_version: ctx.manifest.page.version,
          level: 'L3',
          side_effect: actionDef.side_effect ?? 'identity',
          title: 'Authentication required',
          body: 'Action requires user auth',
          amount: null,
          challenge: null,
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          pii_params: [],
          delegate: null,
          origin: ctx.session.origin,
          resume_hint: resumeHintFor('auth'),
        };
        return buildEnvelope('hold', {
          session: ctx.id,
          page: {
            id: ctx.manifest.page.id,
            url: ctx.manifest.page.url,
            version: ctx.manifest.page.version,
          },
          hold,
        });
      }

      // grant_consent resolves earliest consent gate when present
      if (action === 'grant_consent') {
        const holdFile = holds.load(ctx.id);
        if (holdFile) {
          const earliest = holds.earliestPending(holdFile);
          if (earliest && earliest.kind !== 'consent') {
            return errorEnvelope(
              'app.err.tool.hold_mismatch',
              `Earliest pending gate is ${earliest.kind}; resolve it first`,
              { session: ctx.id },
            );
          }
        }
      }

      const params = actOpts.params ?? {};
      const skipPolicy = !policyStrict;

      try {
        const result = await store.withLock(ctx.id, async () => {
          lastPost.rawBody = undefined;
          return client.invoke(ctx.manifest, action, params, {
            confirmation: actOpts.confirmation,
            idempotencyKey: actOpts.idempotencyKey,
            skipPolicy,
            skipNavigation: actOpts.noFollow,
            conflictRetry: !actOpts.noConflictRetry,
            asyncTimeoutMs: actOpts.noWait || !asyncWait ? 0 : timeoutMs,
          });
        });

        return envelopeFromInvoke(ctx, action, result, actOpts, started);
      } catch (e) {
        if (e instanceof HoldSignal) return e.envelope;
        if (e instanceof AppError) {
          if (e.code === 'app.err.action.confirmation_required') {
            // Should have been HoldSignal via onConfirm; synthesize if needed
            return synthesizeHoldFromError(ctx, action, actionDef, e, params);
          }
          return errorEnvelope(e.code, e.message, {
            session: ctx.id,
            http_status: e.httpStatus,
            request_id: e.requestId,
          });
        }
        if (e instanceof SessionStoreError) {
          return errorEnvelope(e.code, e.message, { session: ctx.id });
        }
        return errorEnvelope(
          'app.err.tool.internal',
          e instanceof Error ? e.message : 'Internal error',
          { session: ctx.id },
        );
      }
    },

    async confirm(opts): Promise<ToolEnvelope> {
      const id = runtime.getCurrentSessionId();
      if (!id) {
        return errorEnvelope('app.err.tool.session_missing', 'No current session');
      }
      const file = holds.load(id);
      if (!file) {
        return errorEnvelope('app.err.tool.hold_mismatch', 'No hold to confirm', {
          session: id,
        });
      }
      if (holds.isExpired(file)) {
        holds.delete(id);
        return errorEnvelope('app.err.action.confirmation_invalid', 'Hold expired', {
          session: id,
        });
      }

      const earliest = holds.earliestPending(file);
      if (!earliest) {
        holds.delete(id);
        return errorEnvelope('app.err.tool.hold_mismatch', 'No pending gate', {
          session: id,
        });
      }

      // Gate kinds use 'hold' for human_verification (MF-10 mapping)
      if (
        earliest.kind !== 'confirmation' &&
        earliest.kind !== 'hold' &&
        earliest.kind !== 'delegate'
      ) {
        return errorEnvelope(
          'app.err.tool.hold_mismatch',
          `Earliest pending gate is ${earliest.kind}; use the matching command`,
          { session: id, details: { gates: file.gates } },
        );
      }

      if (opts.reject) {
        holds.delete(id);
        return buildEnvelope('closed', {
          session: id,
          meta: { warnings: ['confirmation rejected; hold discarded'] },
        });
      }

      if (!opts.approve) {
        return errorEnvelope('app.err.tool.usage', 'Specify --approve or --reject', {
          session: id,
        });
      }

      const token = opts.token ?? file.challenge ?? earliest.challenge;
      if (opts.token && opts.token !== file.challenge && opts.token !== earliest.challenge) {
        return errorEnvelope(
          'app.err.action.confirmation_invalid',
          'Token does not match stored challenge',
          { session: id },
        );
      }
      if (token?.startsWith('uuid-mode:')) {
        return errorEnvelope(
          'app.err.action.confirmation_invalid',
          'Agents must not use Mode B uuid-mode confirmation',
          { session: id },
        );
      }

      const rawBody = decodeRawBody(file.raw_body_b64);
      const session = store.readSession(id);
      let manifest = manifestsBySession.get(id);
      if (!manifest) {
        manifest = await client.hydrate(file.page_url, { force: true });
      }

      try {
        const result = await store.withLock(id, async () => {
          const posted = await client.http.postAction(file.post_url, JSON.parse(rawBody), {
            pageUrl: file.page_url,
            ifMatchVersion: file.if_match_version ?? file.page_version,
            idempotencyKey: file.idempotency_key ?? undefined,
            confirmation: token ?? undefined,
            rawBody,
          });

          if (posted.meta.status === 409) {
            holds.delete(id);
            throw new AppError('app.err.diff.conflict', {
              message: 'Version conflict on confirm; re-act required',
            });
          }
          if (
            posted.meta.status >= 400 &&
            posted.meta.status !== 202 &&
            posted.meta.status !== 303 &&
            posted.meta.status !== 201
          ) {
            try {
              client.http.throwIfError(posted.body, posted.meta);
            } catch (err) {
              if (err instanceof AppError && err.code === 'app.err.action.confirmation_invalid') {
                holds.delete(id);
              }
              throw err;
            }
          }

          // Apply via dispatcher path: hydrate destination / apply diff
          const applied = await applyPostedResponse(client, manifest!, posted, {
            noWait: opts.noWait || !asyncWait,
            timeoutMs,
          });
          return applied;
        });

        holds.delete(id);
        const actionId = file.action;
        const ctx = { id, session, manifest: result.manifest };
        return envelopeFromInvoke(ctx, actionId, result, { noWait: opts.noWait }, Date.now());
      } catch (e) {
        if (e instanceof AppError) {
          return errorEnvelope(e.code, e.message, {
            session: id,
            http_status: e.httpStatus,
          });
        }
        return errorEnvelope(
          'app.err.tool.internal',
          e instanceof Error ? e.message : 'Confirm failed',
          { session: id },
        );
      }
    },

    async challenge(opts): Promise<ToolEnvelope> {
      const id = runtime.getCurrentSessionId();
      if (!id) {
        return errorEnvelope('app.err.tool.session_missing', 'No current session');
      }
      if (opts.kind === 'human_verification' || opts.kind === 'consent') {
        return errorEnvelope(
          'app.err.tool.usage',
          opts.kind === 'consent'
            ? 'use act grant_consent'
            : 'human_verification cannot be completed by challenge submit',
          { session: id },
        );
      }

      const file = holds.load(id);
      if (!file && opts.op === 'submit') {
        return errorEnvelope('app.err.tool.hold_mismatch', 'No challenge hold', {
          session: id,
        });
      }

      if (opts.op === 'abort') {
        if (file) holds.delete(id);
        try {
          const ctx = requireSession();
          if (ctx.manifest.actions?.abandon) {
            return runtime.act('abandon', {});
          }
        } catch {
          /* ignore */
        }
        return buildEnvelope('hold', {
          session: id,
          hold: {
            kind: 'mfa',
            action: file?.action ?? 'unknown',
            page_url: file?.page_url ?? '',
            resume_hint: 'restart the flow',
          },
          meta: { warnings: ['challenge_unattended'] },
        });
      }

      if (!file) {
        return errorEnvelope('app.err.tool.hold_mismatch', 'No hold', { session: id });
      }
      const earliest = holds.earliestPending(file);
      if (earliest && earliest.kind !== 'challenge') {
        return errorEnvelope(
          'app.err.tool.hold_mismatch',
          `Earliest pending gate is ${earliest.kind}`,
          { session: id },
        );
      }

      // Page-step submit_otp if present
      try {
        const ctx = requireSession();
        if (ctx.manifest.actions?.submit_otp && opts.value) {
          return runtime.act('submit_otp', { params: { otp: opts.value } });
        }
      } catch {
        /* fall through */
      }

      // Inline challenge continuation (§18.2): re-POST the stored body with
      // X-APP-Challenge + params[challenge_param] = value.
      if (!opts.value) {
        return errorEnvelope('app.err.tool.usage', '--value required for challenge submit', {
          session: id,
        });
      }
      const session = store.readSession(id);
      let manifest = manifestsBySession.get(id);
      if (!manifest) {
        manifest = await client.hydrate(file.page_url, { force: true });
      }
      try {
        const applied = await store.withLock(id, async () => {
          const original = decodeRawBody(file.raw_body_b64);
          let rawBody = original;
          try {
            const parsed = JSON.parse(original) as { params?: Record<string, unknown> };
            parsed.params = {
              ...(parsed.params ?? {}),
              [file.challenge_param ?? 'otp']: opts.value,
            };
            rawBody = JSON.stringify(parsed);
          } catch {
            /* keep original bytes */
          }
          const posted = await client.http.postAction(file.post_url, null, {
            pageUrl: file.page_url,
            ifMatchVersion: file.if_match_version ?? file.page_version,
            idempotencyKey: file.idempotency_key ?? undefined,
            challenge: file.challenge ?? earliest?.challenge ?? undefined,
            rawBody,
          });
          if (posted.meta.status === 409) {
            throw new AppError('app.err.diff.conflict', {
              message: 'Version conflict on challenge submit; re-act required',
            });
          }
          if (posted.meta.status >= 400) {
            try {
              client.http.throwIfError(posted.body, posted.meta);
            } catch (err) {
              if (err instanceof AppError && err.code === 'app.err.auth.challenge_failed') {
                throw err; // attempts_remaining recorded by server; keep hold for retry
              }
              if (err instanceof AppError) holds.clearEarliest(id, ['challenge']);
              throw err;
            }
          }
          return applyPostedResponse(client, manifest!, posted, {
            noWait: !asyncWait,
            timeoutMs,
          });
        });

        holds.clearEarliest(id, ['challenge']);
        const ctx = { id, session, manifest: applied.manifest };
        return envelopeFromInvoke(ctx, file.action, applied, {}, Date.now());
      } catch (e) {
        if (e instanceof AppError) {
          return errorEnvelope(e.code, e.message, {
            session: id,
            http_status: e.httpStatus,
          });
        }
        return errorEnvelope(
          'app.err.tool.internal',
          e instanceof Error ? e.message : 'Challenge submit failed',
          { session: id },
        );
      }
    },

    async watch(opts = {}): Promise<ToolEnvelope> {
      let ctx: { id: string; session: SessionFile; manifest: PageManifest };
      try {
        ctx = requireSession();
      } catch (e) {
        if (e instanceof ToolLocalError) {
          return errorEnvelope(e.code, e.message, { session: runtime.getCurrentSessionId() });
        }
        throw e;
      }

      const intervalMs = Math.max(
        1000,
        opts.intervalMs ??
          (typeof ctx.manifest.meta?.refresh_hint_ms === 'number'
            ? (ctx.manifest.meta.refresh_hint_ms as number)
            : 5000),
      );

      const etag = ctx.manifest.page.etag ?? ctx.session.current?.etag ?? undefined;
      const { meta, body } = await client.http.get(ctx.manifest.page.url, {
        ifNoneMatch: etag,
        pageUrl: ctx.manifest.page.url,
      });

      if (meta.status === 304) {
        return buildEnvelope(opts.once ? 'not_modified' : 'not_modified', {
          session: ctx.id,
          page: {
            id: ctx.manifest.page.id,
            url: ctx.manifest.page.url,
            version: ctx.manifest.page.version,
            etag: ctx.manifest.page.etag,
          },
          watch: {
            transport: 'poll',
            changed: false,
            subscription_id: null,
            interval_ms: intervalMs,
            last_event_id: null,
          },
        });
      }

      if (body && typeof body === 'object' && 'page' in (body as object)) {
        const manifest = body as PageManifest;
        touchSession(ctx.session, manifest);
        return buildEnvelope('ok', {
          session: ctx.id,
          page: {
            id: manifest.page.id,
            url: manifest.page.url,
            version: manifest.page.version,
            etag: manifest.page.etag,
          },
          digest: makeDigest(manifest, ctx.session.origin),
          watch: {
            transport: 'poll',
            changed: true,
            subscription_id: null,
            interval_ms: intervalMs,
            last_event_id: null,
          },
        });
      }

      return buildEnvelope('ok', {
        session: ctx.id,
        page: {
          id: ctx.manifest.page.id,
          url: ctx.manifest.page.url,
          version: ctx.manifest.page.version,
        },
        watch: {
          transport: 'poll',
          changed: false,
          subscription_id: null,
          interval_ms: intervalMs,
          last_event_id: null,
        },
      });
    },

    async sessions(op: string, id?: string): Promise<ToolEnvelope> {
      const current = runtime.getCurrentSessionId();
      if (op === 'list' || !op) {
        const list = store.listSessions().map(toSummary);
        return buildEnvelope('ok', {
          session: current,
          sessions: list,
        });
      }
      if (op === 'show') {
        const sid = id ?? current;
        if (!sid) {
          return errorEnvelope('app.err.tool.session_missing', 'No session');
        }
        try {
          const s = store.readSession(sid);
          const holdFile = holds.load(sid);
          return buildEnvelope('ok', {
            session: sid,
            sessions: [toSummary(s)],
            hold: holdFile ? publicHoldFromFile(holdFile) : null,
            page: s.current
              ? {
                  id: s.current.page_id,
                  url: s.current.url,
                  version: s.current.version,
                  title: s.current.title ?? undefined,
                  etag: s.current.etag ?? undefined,
                }
              : undefined,
          });
        } catch (e) {
          if (e instanceof SessionStoreError) {
            return errorEnvelope(e.code, e.message);
          }
          throw e;
        }
      }
      if (op === 'switch') {
        if (!id) {
          return errorEnvelope('app.err.tool.usage', 'sessions switch requires id');
        }
        const index = store.readIndex();
        if (!index.sessions.includes(id)) {
          return errorEnvelope('app.err.tool.session_missing', `Unknown session ${id}`);
        }
        index.current = id;
        store.writeIndex(index);
        const s = store.readSession(id);
        if (s.current) {
          const manifest = await client.hydrate(s.current.url, { force: true });
          touchSession(s, manifest);
          return buildEnvelope('ok', {
            session: id,
            page: {
              id: manifest.page.id,
              url: manifest.page.url,
              version: manifest.page.version,
            },
            digest: makeDigest(manifest, s.origin),
          });
        }
        return buildEnvelope('ok', { session: id });
      }
      if (op === 'close') {
        const sid = id ?? current;
        if (!sid) {
          return errorEnvelope('app.err.tool.session_missing', 'No session');
        }
        store.deleteSession(sid);
        manifestsBySession.delete(sid);
        return buildEnvelope('closed', { session: store.readIndex().current });
      }
      if (op === 'gc') {
        const deleted = store.gc();
        return buildEnvelope('ok', {
          session: store.readIndex().current,
          sessions: deleted.map((d) => ({
            id: d,
            origin: '',
            updated_at: new Date().toISOString(),
          })),
          meta: { warnings: [`gc deleted ${deleted.length} sessions`] },
        });
      }
      return errorEnvelope('app.err.tool.usage', `Unknown sessions op: ${op}`);
    },

    async logout(origin?: string, all?: boolean): Promise<ToolEnvelope> {
      const current = runtime.getCurrentSessionId();
      if (all) {
        return runtime.reset({ all: true });
      }
      let target = origin;
      if (!target && current) {
        try {
          target = store.readSession(current).origin;
        } catch {
          target = undefined;
        }
      }
      if (target) {
        credentials.drop(target);
        store.deleteResume(target);
        client.cache.invalidatePrivate();
      } else {
        credentials.dropAll();
      }
      return buildEnvelope('closed', {
        session: current,
        meta: {
          warnings: [target ? `private cache purged for ${target}` : 'credentials cleared'],
        },
      });
    },

    async reset(opts = {}): Promise<ToolEnvelope> {
      if (opts.all) {
        store.resetAll();
        manifestsBySession.clear();
        wellKnownByOrigin.clear();
        return buildEnvelope('ok', {
          session: null,
          sessions: [],
          meta: { warnings: ['reset --all; home cleared'] },
        });
      }
      const id = opts.session ?? runtime.getCurrentSessionId();
      if (!id) {
        return errorEnvelope('app.err.tool.session_missing', 'No session to reset');
      }
      holds.delete(id);
      const session = store.readSession(id);
      if (!session.current) {
        return errorEnvelope('app.err.tool.session_missing', 'No current page');
      }
      session.stack = [session.current.url];
      session.last_action = null;
      const manifest = await client.hydrate(session.current.url, { force: true });
      touchSession(session, manifest);
      return buildEnvelope('ok', {
        session: id,
        page: {
          id: manifest.page.id,
          url: manifest.page.url,
          version: manifest.page.version,
        },
        digest: makeDigest(manifest, session.origin),
        meta: { warnings: ['session reset; rehydrated'] },
      });
    },

    async state(opts = {}): Promise<ToolEnvelope> {
      let ctx: { id: string; session: SessionFile; manifest: PageManifest };
      try {
        ctx = requireSession();
      } catch (e) {
        if (e instanceof ToolLocalError) {
          return errorEnvelope(e.code, e.message, { session: runtime.getCurrentSessionId() });
        }
        throw e;
      }
      const d = makeDigest(ctx.manifest, ctx.session.origin);
      if (opts.path) {
        const pointer = opts.path.replace(/^\/state\//, '');
        if (opts.path.startsWith('/state/')) {
          const key = pointer.split('/')[0]!;
          if (!(key in (ctx.manifest.state ?? {}))) {
            return errorEnvelope('app.err.diff.invalid_path', `Invalid path ${opts.path}`, {
              session: ctx.id,
            });
          }
          return buildEnvelope('ok', {
            session: ctx.id,
            page: d.page,
            digest: {
              ...d,
              state: {
                selected: (ctx.manifest.state as Record<string, unknown>)[key],
              },
              actions: [],
            },
          });
        }
        return errorEnvelope('app.err.diff.invalid_path', `Invalid path ${opts.path}`, {
          session: ctx.id,
        });
      }
      return buildEnvelope('ok', {
        session: ctx.id,
        page: d.page,
        digest: d,
      });
    },

    async actions(): Promise<ToolEnvelope> {
      let ctx: { id: string; session: SessionFile; manifest: PageManifest };
      try {
        ctx = requireSession();
      } catch (e) {
        if (e instanceof ToolLocalError) {
          return errorEnvelope(e.code, e.message, { session: runtime.getCurrentSessionId() });
        }
        throw e;
      }
      const d = makeDigest(ctx.manifest, ctx.session.origin);
      return buildEnvelope('ok', {
        session: ctx.id,
        page: d.page,
        digest: { ...d, state: {} },
      });
    },

    async navigate(url: string): Promise<ToolEnvelope> {
      const id = runtime.getCurrentSessionId();
      if (!id) {
        return errorEnvelope('app.err.tool.session_missing', 'No current session');
      }
      let session: SessionFile;
      try {
        session = store.readSession(id);
      } catch (e) {
        if (e instanceof SessionStoreError) {
          return errorEnvelope(e.code, e.message, { session: id });
        }
        throw e;
      }
      let absolute: string;
      try {
        absolute = resolveAppUrl(url, session.origin);
      } catch {
        return errorEnvelope('app.err.navigation.invalid_url', 'Invalid URL', {
          session: id,
        });
      }
      if (extractOrigin(absolute) !== session.origin) {
        return errorEnvelope('app.err.security.cross_origin', 'Cross-origin navigate forbidden', {
          session: id,
        });
      }
      return runtime.open(absolute, { force: true });
    },
  };

  function envelopeFromInvoke(
    ctx: { id: string; session: SessionFile; manifest: PageManifest },
    action: string,
    result: InvokeResult,
    actOpts: ActOptions,
    started: number,
  ): ToolEnvelope {
    const baseVersion = ctx.manifest.page.version;
    const manifest = result.manifest;
    touchSession(ctx.session, manifest, {
      last_action: {
        id: action,
        at: new Date().toISOString(),
        idempotency_key: actOpts.idempotencyKey ?? null,
        result_version: manifest.page.version,
        mode: result.mode,
      },
    });

    const softFailed = manifest.error?.code === 'app.err.action.async_failed';

    if (result.mode === 'redirect' || result.navigation_effect) {
      const d = makeDigest(manifest, ctx.session.origin);
      const act: ActResult = {
        action,
        mode: 'redirect',
        base_version: baseVersion,
        result_version: manifest.page.version,
        diff: [],
        state_delta: {},
        actions_delta: { added: [], removed: [], replaced: [] },
        navigation_effect: result.navigation_effect ?? {
          url: manifest.page.url,
          mode: 'push',
          reason: action,
        },
        idempotency_key: actOpts.idempotencyKey ?? null,
      };
      return buildEnvelope('navigated', {
        session: ctx.id,
        request_id: result.request_id ?? null,
        page: d.page,
        act,
        digest: d,
        meta: {
          warnings: [],
          duration_ms: Date.now() - started,
          cache: 'miss',
          negotiated_version: ctx.session.protocol_version,
        },
      });
    }

    // Async Form D
    const opNode = manifest.state?.operation_status as
      { type?: string; value?: { state?: string; status_url?: string } } | undefined;
    const opState =
      opNode && 'value' in (opNode as object)
        ? (opNode as { value?: { state?: string } }).value?.state
        : undefined;

    if (result.mode === 'async' || opState) {
      const pending = actOpts.noWait || !asyncWait || opState === 'queued' || opState === 'running';
      const status = softFailed
        ? 'async_failed'
        : pending
          ? opState === 'succeeded'
            ? 'async_succeeded'
            : 'async_pending'
          : opState === 'succeeded'
            ? 'async_succeeded'
            : opState === 'failed' || opState === 'cancelled'
              ? 'async_failed'
              : 'async_pending';

      const d = makeDigest(manifest, ctx.session.origin);
      return buildEnvelope(status as ToolEnvelope['status'], {
        session: ctx.id,
        page: d.page,
        act: {
          action,
          mode: 'async',
          base_version: baseVersion,
          result_version: manifest.page.version,
          diff: [],
          state_delta: {},
          actions_delta: { added: [], removed: [], replaced: [] },
          navigation_effect: null,
          idempotency_key: actOpts.idempotencyKey ?? null,
        },
        digest: d,
        meta: {
          warnings: [],
          duration_ms: Date.now() - started,
          cache: 'bypass',
          negotiated_version: ctx.session.protocol_version,
        },
      });
    }

    // Diff mode
    const diffOps =
      result.document && typeof result.document === 'object' && 'diff' in result.document
        ? ((result.document as { diff: unknown[] }).diff ?? [])
        : [];
    const deltas = stateDelta(diffOps, manifest);
    const act: ActResult = {
      action,
      mode: result.mode === 'full' ? 'full' : 'diff',
      base_version: baseVersion,
      result_version: manifest.page.version,
      diff: diffOps,
      state_delta: deltas.state_delta,
      actions_delta: deltas.actions_delta,
      navigation_effect: null,
      idempotency_key: actOpts.idempotencyKey ?? null,
    };

    return buildEnvelope('ok', {
      session: ctx.id,
      request_id: result.request_id ?? null,
      page: {
        id: manifest.page.id,
        url: manifest.page.url,
        version: manifest.page.version,
        title: manifest.page.title,
        etag: manifest.page.etag,
      },
      act,
      ...(full || raw ? { digest: makeDigest(manifest, ctx.session.origin) } : {}),
      meta: {
        warnings: [],
        duration_ms: Date.now() - started,
        cache: 'bypass',
        negotiated_version: ctx.session.protocol_version,
        truncated: false,
      },
    });
  }

  function synthesizeHoldFromError(
    ctx: { id: string; session: SessionFile; manifest: PageManifest },
    action: string,
    actionDef: ActionDef,
    err: AppError,
    params: Record<string, unknown>,
  ): ToolEnvelope {
    const challenge =
      err.envelope.error.confirmation_challenge ??
      (err.envelope.error.details?.confirmation_challenge as { value?: string } | undefined)
        ?.value ??
      null;
    const rawBody =
      lastPost.rawBody ??
      JSON.stringify({
        app: '1.0',
        action,
        params,
        client: { kind: 'agent', name: clientName, version: clientVersion },
        context: {
          page_id: ctx.manifest.page.id,
          page_url: ctx.manifest.page.url,
          manifest_version: ctx.manifest.page.version,
        },
      });
    const file = holds.persist(ctx.id, {
      kind: 'confirmation',
      action,
      page_url: ctx.manifest.page.url,
      page_version: ctx.manifest.page.version,
      post_url: lastPost.postUrl ?? ctx.manifest.page.url,
      challenge,
      idempotency_key: lastPost.idempotencyKey ?? null,
      if_match_version: lastPost.ifMatchVersion ?? ctx.manifest.page.version,
      raw_body: rawBody,
      side_effect: actionDef.side_effect ?? 'safe',
      origin: ctx.session.origin,
    });
    return buildEnvelope('hold', {
      session: ctx.id,
      page: {
        id: ctx.manifest.page.id,
        url: ctx.manifest.page.url,
        version: ctx.manifest.page.version,
      },
      hold: publicHoldFromFile(file),
    });
  }

  return runtime;
}

class ToolLocalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolLocalError';
  }
}

function toolErr(code: string, message: string): ToolLocalError {
  return new ToolLocalError(code, message);
}

function toSummary(s: SessionFile): SessionSummary {
  return {
    id: s.id,
    origin: s.origin,
    title: s.title ?? null,
    current_page_id: s.current?.page_id ?? null,
    current_url: s.current?.url ?? null,
    current_version: s.current?.version ?? null,
    hold_kind: null,
    created_at: s.created_at,
    updated_at: s.updated_at,
    last_used_at: s.last_used_at,
  };
}

function formatConfirmBody(req: {
  actionDef: {
    confirm?: { body_template?: string | null; title?: string | null };
    description?: string;
  };
  amount?: { value: number; unit?: string; scale?: number };
}): string {
  const template = req.actionDef.confirm?.body_template;
  if (template) return template;
  if (req.amount) {
    return `Pay ${req.amount.value} ${req.amount.unit ?? ''}?`.trim();
  }
  return req.actionDef.description ?? 'Confirm action?';
}

async function applyPostedResponse(
  client: AgentClient,
  base: PageManifest,
  posted: {
    meta: {
      status: number;
      location: string | null;
      mediaType: string | null;
      resultVersion: string | null;
    };
    body: unknown;
  },
  opts: { noWait: boolean; timeoutMs: number },
): Promise<InvokeResult> {
  const { meta, body } = posted;

  if (meta.status === 202) {
    const accepted = body as PageManifest;
    client.cache.set(accepted.page.url, accepted, { etag: accepted.page.etag });
    if (opts.noWait) {
      return { manifest: accepted, mode: 'async', document: accepted };
    }
    // Poll Form D locally (SDK pollAsyncOperation may still be private in dist typings)
    const final = await pollAsyncLocal(client, accepted, opts.timeoutMs);
    return { manifest: final, mode: 'async', document: final };
  }

  if (meta.status === 303 || meta.status === 201) {
    const location = meta.location;
    if (location) {
      const next = await client.hydrate(resolveAppUrl(location, base.page.url), {
        fromPageUrl: base.page.url,
        force: true,
      });
      return {
        manifest: next,
        mode: 'redirect',
        document: null,
        navigation_effect: { url: next.page.url, mode: 'push', reason: 'confirm' },
      };
    }
  }

  if (
    body &&
    typeof body === 'object' &&
    'diff' in (body as object) &&
    'base_version' in (body as object)
  ) {
    const next = client.applyDiff(base, body as Parameters<AgentClient['applyDiff']>[1]);
    return { manifest: next, mode: 'diff', document: body as InvokeResult['document'] };
  }

  if (body && typeof body === 'object' && 'page' in (body as object)) {
    const manifest = body as PageManifest;
    client.cache.set(manifest.page.url, manifest, { etag: manifest.page.etag });
    return { manifest, mode: 'full', document: manifest };
  }

  // Fallback re-GET
  const fresh = await client.hydrate(base.page.url, { force: true });
  return { manifest: fresh, mode: 'full', document: fresh };
}

async function pollAsyncLocal(
  client: AgentClient,
  accepted: PageManifest,
  timeoutMs: number,
): Promise<PageManifest> {
  const statusNode = accepted.state?.operation_status as
    | { value?: { status_url?: { value?: string } | string; state?: { value?: string } | string } }
    | undefined;
  const rawUrl = statusNode?.value?.status_url;
  const statusUrl =
    typeof rawUrl === 'string'
      ? rawUrl
      : rawUrl && typeof rawUrl === 'object'
        ? rawUrl.value
        : undefined;
  if (!statusUrl) return accepted;

  const pollInterval = Math.max(
    500,
    typeof accepted.meta?.poll_interval_ms === 'number'
      ? (accepted.meta.poll_interval_ms as number)
      : 2000,
  );
  const deadline = Date.now() + timeoutMs;
  let current = accepted;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));
    current = await client.hydrate(resolveAppUrl(statusUrl, accepted.page.url), {
      force: true,
      bypassCache: true,
      fromPageUrl: accepted.page.url,
    });
    const op = current.state?.operation_status as
      { value?: { state?: { value?: string } | string } } | undefined;
    const state =
      typeof op?.value?.state === 'string'
        ? op.value.state
        : op?.value?.state && typeof op.value.state === 'object'
          ? (op.value.state as { value?: string }).value
          : undefined;
    if (state === 'succeeded' || state === 'failed' || state === 'cancelled') {
      return current;
    }
  }
  return current;
}
