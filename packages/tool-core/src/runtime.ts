/**
 * ToolRuntime wrapping AgentClient + store.
 * onConfirm MUST persist hold + throw HoldSignal; NEVER return {approved:true}.
 */

import { readFileSync } from 'node:fs';
import {
  AgentClient,
  AppError,
  findAction,
  isDiffDocument,
  isLoopbackHost,
  isPageManifest,
  isSoftErrorCode,
  extractOrigin,
  normalizeAppUrl,
  resolveAppUrl,
  requireNavigateLocation,
  type ConfirmationRequest,
  type DiffDocument,
  type FetchLike,
  type InvokeOptions,
  type InvokeResult,
  type PageManifest,
  type StateNode,
} from '@agent-page/client';
import {
  capabilitiesFromWellKnown,
  entryUrlsFromWellKnown,
  featuresFromWellKnown,
  normalizeAuth,
} from './capabilities.js';
import {
  persistChallengeHold,
  extractChallenge,
  submitChallengeContinuation,
  applyChallengeFailure,
  isPageStepOtp,
} from './challenge.js';
import { resolveConfig, type ResolvedToolConfig } from './config.js';
import { CredentialResolver } from './credentials.js';
import { digest, stateDelta } from './digest.js';
import { HoldSignal, buildEnvelope, errorEnvelope } from './envelope.js';
import {
  HoldStore,
  assertNotUuidMode,
  publicHoldFromFile,
  resolveEarliestGate,
  markGateCleared,
} from './holds.js';
import {
  refuseCompleteHold,
  refuseHumanVerificationChallengeSubmit,
  persistHumanHold,
  extractHumanHold,
  holdTokenHeaders,
} from './human-hold.js';
import { captureResumeFromHeaders, loadResumeToken, resumeHeaders } from './resume.js';
import { SessionStore, generateSessionId, isSessionId } from './session-store.js';
import type {
  ActResult,
  Discovery,
  Hold,
  PageRef,
  SessionFile,
  SessionSummary,
  ToolEnvelope,
} from './types.js';
import { TOOL_VERSION } from './types.js';
import {
  pollAsyncOperationWithClient,
  watchOnce,
  watchResultFromOnce,
  intervalFromManifest,
} from './watch.js';

export interface CreateRuntimeOptions {
  home?: string;
  fetch?: FetchLike;
  dynamicTools?: boolean;
  clientName?: string;
  clientVersion?: string;
  bearerEnv?: string;
  cookieJar?: string;
  policyStrict?: boolean;
  topK?: number;
}

export interface PageActionDef {
  id: string;
  description?: string;
  kind?: string;
  side_effect?: string;
  requires_confirmation?: boolean;
  idempotent?: boolean;
  auth?: string;
  input?: Record<string, unknown>;
  params?: Array<{
    name: string;
    type?: string;
    required?: boolean;
    enum?: unknown[];
    description?: string;
  }>;
}

export interface SessionPublic {
  id: string;
  origin: string;
  title?: string | null;
  current_page_id?: string | null;
  current_url?: string | null;
  current_version?: string | null;
  hold_kind?: string | null;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
}

interface LastPost {
  url: string;
  rawBody: string;
  idempotencyKey?: string;
  ifMatchVersion?: string;
}

function pageRefOf(manifest: PageManifest): PageRef {
  return {
    id: manifest.page.id,
    url: manifest.page.url,
    version: manifest.page.version,
    title: manifest.page.title,
    etag: manifest.page.etag,
    description: manifest.page.description,
  };
}

function wouldBeBody(
  manifest: PageManifest,
  actionId: string,
  params: Record<string, unknown>,
  clientName: string,
  clientVersion: string,
): string {
  return JSON.stringify({
    app: '1.0',
    action: actionId,
    params,
    client: { kind: 'agent', name: clientName, version: clientVersion },
    context: {
      page_id: manifest.page.id,
      page_url: manifest.page.url,
      manifest_version: manifest.page.version,
    },
  });
}

function assertSafeUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AppError('app.err.navigation.invalid_url', { message: `Invalid URL: ${url}` });
  }
  if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) {
    throw new AppError('app.err.security.tls', {
      message: 'Non-loopback http: URLs fail before fetch',
    });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new AppError('app.err.navigation.invalid_url', {
      message: `Unsupported protocol: ${u.protocol}`,
    });
  }
  return u;
}

function holdEnvelope(hold: Hold, session: string | null, page?: PageRef): ToolEnvelope {
  return buildEnvelope('hold', { session, page, hold, meta: { warnings: [] } });
}

export class ToolRuntime {
  readonly client: AgentClient;
  readonly store: SessionStore;
  readonly credentials: CredentialResolver;
  readonly holds: HoldStore;
  readonly config: ResolvedToolConfig;
  readonly clientName: string;
  readonly clientVersion: string;
  private currentId: string | null = null;
  private lastPost: LastPost | null = null;
  private readonly manifests = new Map<string, PageManifest>();
  private readonly wellKnown = new Map<string, Record<string, unknown>>();
  readonly digest = digest;

  constructor(opts: CreateRuntimeOptions = {}) {
    this.config = resolveConfig(
      {
        home: opts.home,
        dynamicTools: opts.dynamicTools,
        clientName: opts.clientName,
        policyStrict: opts.policyStrict,
        topK: opts.topK,
      },
      opts.home,
    );
    this.clientName = opts.clientName ?? this.config.clientName;
    this.clientVersion = opts.clientVersion ?? TOOL_VERSION;
    this.store = new SessionStore(this.config.home, { sessionTtlMs: this.config.sessionTtlMs });
    this.store.ensureHome();
    this.store.loadCacheFromDisk();
    this.holds = new HoldStore(this.store);
    this.credentials = new CredentialResolver({
      bearerEnv: opts.bearerEnv,
      cookieJar: opts.cookieJar,
    });
    this.currentId = this.store.readIndex().current;

    this.client = new AgentClient({
      fetch: opts.fetch,
      getAuthHeaders: () => this.credentials.getAuthHeaders(),
      cache: this.store.cache,
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      policy: { neverSpeculate: true },
      onConfirm: async (req: ConfirmationRequest) => this.onConfirm(req),
      // Tool contract: 428 challenges surface as holds (app_challenge), not
      // inline collection. Re-throw so the act() hold path sees
      // challenge_required rather than the client's challenge_unattended.
      onChallenge: async (req) => {
        throw new AppError('app.err.auth.challenge_required', {
          message: 'challenge required; persisted as hold',
          details: {
            challenge: {
              type: 'object',
              value: {
                id: { type: 'string', value: req.challenge.id },
                kind: { type: 'string', value: req.challenge.kind },
                ...(req.challenge.param !== undefined
                  ? { param: { type: 'string', value: req.challenge.param } }
                  : {}),
                ...(req.challenge.ttl_ms !== undefined
                  ? { ttl_ms: { type: 'number', value: req.challenge.ttl_ms } }
                  : {}),
                ...(req.challenge.attempts_remaining !== undefined
                  ? {
                      attempts_remaining: {
                        type: 'number',
                        value: req.challenge.attempts_remaining,
                      },
                    }
                  : {}),
                ...(req.challenge.expires_at !== undefined
                  ? { expires_at: { type: 'datetime', value: req.challenge.expires_at } }
                  : {}),
                ...(req.challenge.poll_interval_ms !== undefined
                  ? {
                      poll_interval_ms: {
                        type: 'number',
                        value: req.challenge.poll_interval_ms,
                      },
                    }
                  : {}),
              },
            } as StateNode,
          },
        });
      },
    });
    this.installHttpHooks();
  }

  private installHttpHooks(): void {
    const http = this.client.http;
    const origPost = http.postAction.bind(http);
    const origGet = http.get.bind(http);
    const origRequest = http.request.bind(http);

    http.postAction = async (url, body, options) => {
      const origin = extractOrigin(options.pageUrl);
      const extra = { ...(options.extraHeaders ?? {}) };
      const token = loadResumeToken(this.store, origin);
      if (token && !extra['X-APP-Resume']) Object.assign(extra, resumeHeaders(token));
      const result = await origPost(url, body, { ...options, extraHeaders: extra });
      this.lastPost = {
        url,
        rawBody: result.rawBody,
        idempotencyKey: options.idempotencyKey,
        ifMatchVersion: options.ifMatchVersion,
      };
      this.noteResume(origin, result.res.headers);
      return result;
    };

    http.get = async (url, options = {}) => {
      const pageUrl = options.pageUrl ?? url;
      const origin = extractOrigin(pageUrl);
      const extra = { ...(options.extraHeaders ?? {}) };
      const token = loadResumeToken(this.store, origin);
      if (token && !extra['X-APP-Resume']) Object.assign(extra, resumeHeaders(token));
      const result = await origGet(url, { ...options, extraHeaders: extra });
      this.noteResume(origin, result.res.headers);
      return result;
    };

    http.request = async (url, init = {}) => {
      const result = await origRequest(url, init);
      try {
        const origin = extractOrigin(String(init.pageUrl ?? url));
        this.noteResume(origin, result.res.headers);
      } catch {
        /* ignore */
      }
      return result;
    };
  }

  private noteResume(origin: string, headers: Headers): void {
    const sid = this.currentId;
    const session = sid
      ? (() => {
          try {
            return this.store.readSession(sid);
          } catch {
            return null;
          }
        })()
      : null;
    const updated = captureResumeFromHeaders(this.store, origin, headers, session);
    if (updated && sid) this.store.writeSession(updated);
  }

  /** Persist + throw HoldSignal. NEVER return {approved:true}. */
  private async onConfirm(req: ConfirmationRequest): Promise<{ approved: false }> {
    assertNotUuidMode(req.challenge);
    const sid = this.requireSessionId();
    const session = this.store.readSession(sid);
    const rawBody =
      (req.challenge ? this.lastPost?.rawBody : undefined) ??
      wouldBeBody(req.manifest, req.actionId, req.params, this.clientName, this.clientVersion);
    const file = this.holds.persist({
      sessionId: sid,
      kind: 'confirmation',
      action: req.actionId,
      page_url: req.manifest.page.url,
      page_version: req.manifest.page.version,
      post_url: this.lastPost?.url ?? req.manifest.page.url,
      rawBody,
      challenge: req.challenge ?? null,
      idempotency_key: this.lastPost?.idempotencyKey ?? null,
      if_match_version: this.lastPost?.ifMatchVersion ?? req.manifest.page.version,
      level: req.level,
      side_effect: req.actionDef.side_effect,
      amount: req.amount ?? null,
      title: req.actionDef.confirm?.title ?? null,
      body: req.actionDef.confirm?.body_template ?? null,
      origin: session.origin,
      preflight: !req.challenge,
    });
    throw new HoldSignal(holdEnvelope(publicHoldFromFile(file), sid, pageRefOf(req.manifest)));
  }

  getCurrentSessionId(): string | null {
    return this.currentId ?? this.store.readIndex().current;
  }

  setCurrentSessionId(id: string | null): void {
    this.currentId = id;
    if (id) {
      const index = this.store.readIndex();
      index.current = id;
      this.store.writeIndex(index);
    }
  }

  private requireSessionId(explicit?: string | null): string {
    const id = explicit ?? this.getCurrentSessionId();
    if (!id) {
      throw new AppError('app.err.tool.session_missing', { message: 'No current session' });
    }
    return id;
  }

  private async withSession<T>(
    explicit: string | null | undefined,
    fn: (s: SessionFile) => Promise<T>,
  ): Promise<T> {
    const id = this.requireSessionId(explicit);
    return this.store.withLock(id, async () => {
      const s = this.store.readSession(id);
      this.currentId = id;
      return fn(s);
    });
  }

  listSessions(): SessionPublic[] {
    return this.store.listSessions().map((s) => this.toPublic(s));
  }

  private toPublic(s: SessionFile): SessionPublic {
    const hold = this.holds.load(s.id);
    return {
      id: s.id,
      origin: s.origin,
      title: s.title ?? null,
      current_page_id: s.current?.page_id ?? null,
      current_url: s.current?.url ?? null,
      current_version: s.current?.version ?? null,
      hold_kind: hold?.kind ?? null,
      created_at: s.created_at,
      updated_at: s.updated_at,
      last_used_at: s.last_used_at,
    };
  }

  private digestOpts(session: SessionFile, args: Record<string, unknown> = {}) {
    const topK = typeof args.top_k === 'number' ? args.top_k : this.config.topK;
    return {
      topK,
      capabilities: session.capabilities,
      features: featuresFromWellKnown(this.wellKnown.get(session.origin)),
      full: args.full === true,
    };
  }

  private rememberManifest(
    sessionId: string,
    manifest: PageManifest,
    session: SessionFile,
  ): SessionFile {
    this.manifests.set(sessionId, manifest);
    const url = manifest.page.url;
    const next: SessionFile = {
      ...session,
      current: {
        page_id: manifest.page.id,
        url,
        version: manifest.page.version,
        etag: manifest.page.etag ?? null,
        title: manifest.page.title ?? null,
      },
      stack: session.stack.includes(url) ? session.stack : [...session.stack, url].slice(-64),
      protocol_version: manifest.app ?? session.protocol_version,
    };
    this.store.writeSession(next);
    this.store.dumpCacheToDisk();
    return next;
  }

  async getSessionDigest(sessionId: string): Promise<ToolEnvelope | null> {
    try {
      const s = this.store.readSession(sessionId);
      const manifest = await this.manifestFor(s);
      return buildEnvelope('ok', {
        session: sessionId,
        page: pageRefOf(manifest),
        digest: digest(manifest, this.digestOpts(s)),
      });
    } catch {
      return null;
    }
  }

  async getSessionManifest(sessionId: string): Promise<Record<string, unknown> | null> {
    try {
      const s = this.store.readSession(sessionId);
      const m = await this.manifestFor(s);
      const { present: _p, ...rest } = m;
      return rest as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async getSessionHoldPublic(sessionId: string): Promise<Record<string, unknown> | null> {
    const file = this.holds.load(sessionId);
    if (!file) return { hold: null };
    const pub = publicHoldFromFile(file) as unknown as Record<string, unknown>;
    return pub;
  }

  listWellKnownOrigins(): string[] {
    return [...this.wellKnown.keys()];
  }

  async getWellKnown(origin: string): Promise<Record<string, unknown> | null> {
    return this.wellKnown.get(origin) ?? null;
  }

  async getPageActions(
    sessionId: string,
  ): Promise<{ pageId: string; actions: PageActionDef[] } | null> {
    try {
      const s = this.store.readSession(sessionId);
      const m = await this.manifestFor(s);
      const actions: PageActionDef[] = Object.entries(m.actions ?? {}).map(([id, def]) => ({
        id,
        description: def.description,
        kind: def.kind,
        side_effect: def.side_effect,
        requires_confirmation: def.requires_confirmation,
        idempotent: def.idempotent,
        auth: def.auth,
        input: def.input as Record<string, unknown> | undefined,
      }));
      return { pageId: m.page.id, actions };
    } catch {
      return null;
    }
  }

  private async manifestFor(session: SessionFile): Promise<PageManifest> {
    const cached = this.manifests.get(session.id);
    if (cached) return cached;
    if (!session.current?.url) {
      throw new AppError('app.err.tool.session_missing', {
        message: 'Session has no current page',
      });
    }
    const m = await this.client.hydrate(session.current.url);
    this.manifests.set(session.id, m);
    return m;
  }

  private catchToEnvelope(err: unknown, session?: string | null): ToolEnvelope {
    if (err instanceof HoldSignal) return err.envelope;
    if (err instanceof AppError) {
      return errorEnvelope(err.code, err.message, {
        session: session ?? this.currentId,
        http_status: err.httpStatus,
        request_id: err.requestId,
        retryable: err.envelope.error.retryable,
        details: err.envelope.error.details as Record<string, unknown> | undefined,
      });
    }
    const message = err instanceof Error ? err.message : 'internal error';
    return errorEnvelope('app.err.tool.internal', message, { session: session ?? this.currentId });
  }

  async discover(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      const rawUrl = String(args.url ?? '');
      const u = assertSafeUrl(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
      const origin = `${u.protocol}//${u.host}`;
      const wellKnownUrl = `${origin}/.well-known/agent-page`;
      const { meta, body } = await this.client.http.get(wellKnownUrl, { pageUrl: origin });
      if (meta.status === 404 || meta.status >= 400) {
        return errorEnvelope('app.err.discovery.not_supported', 'Origin does not speak APP', {
          http_status: meta.status,
        });
      }
      const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      this.wellKnown.set(origin, rec);
      const discovery: Discovery = {
        origin,
        well_known_url: wellKnownUrl,
        supported: true,
        site_name: typeof rec.site_name === 'string' ? rec.site_name : null,
        protocol_version:
          typeof rec.protocol_version === 'string'
            ? rec.protocol_version
            : typeof rec.app === 'string'
              ? rec.app
              : null,
        capabilities: capabilitiesFromWellKnown(rec),
        entry_urls: entryUrlsFromWellKnown(rec),
      };
      return buildEnvelope('ok', {
        session: typeof args.session === 'string' ? args.session : null,
        discovery,
        meta: { warnings: [], negotiated_version: discovery.protocol_version ?? '1.0' },
      });
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  async open(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      const rawUrl = String(args.url ?? '');
      if (!rawUrl.includes('://')) {
        throw new AppError('app.err.navigation.invalid_url', { message: 'Relative URL rejected' });
      }
      assertSafeUrl(rawUrl);
      const url = normalizeAppUrl(resolveAppUrl(rawUrl, rawUrl));
      const origin = extractOrigin(url);
      const doDiscover = args.discover !== false;
      if (doDiscover && !this.wellKnown.has(origin)) {
        await this.discover({ url: origin });
      }
      const wk = this.wellKnown.get(origin);
      const caps = capabilitiesFromWellKnown(wk);
      const features = featuresFromWellKnown(wk);

      let session: SessionFile | null = null;
      const explicit = typeof args.session === 'string' ? args.session : this.getCurrentSessionId();
      if (explicit) {
        try {
          const existing = this.store.readSession(explicit);
          if (existing.origin !== origin) {
            throw new AppError('app.err.tool.session_origin_mismatch', {
              message: 'Session origin does not match URL origin',
            });
          }
          session = existing;
        } catch (e) {
          if (e instanceof AppError && e.code === 'app.err.tool.session_origin_mismatch') throw e;
          session = null;
        }
      }
      if (!session) {
        const id =
          typeof args.session_id === 'string' && isSessionId(args.session_id)
            ? args.session_id
            : generateSessionId();
        session = this.store.createSession({
          origin,
          title: typeof args.title === 'string' ? args.title : null,
          capabilities: caps,
          id,
        });
      }
      this.currentId = session.id;
      session.capabilities = caps;
      session.flags = { ...session.flags, v05_features: Object.values(features).some(Boolean) };

      const manifest = await this.client.hydrate(url, { force: args.force === true });
      session = this.rememberManifest(session.id, manifest, session);
      const d = digest(manifest, {
        topK: typeof args.top_k === 'number' ? args.top_k : this.config.topK,
        capabilities: caps,
        features,
      });
      return buildEnvelope('ok', {
        session: session.id,
        page: pageRefOf(manifest),
        digest: d,
        meta: {
          warnings: [],
          cache: args.force === true ? 'bypass' : 'miss',
          negotiated_version: manifest.app,
          truncated: d.truncated,
        },
      });
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  async read(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      return await this.withSession(
        typeof args.session === 'string' ? args.session : null,
        async (s) => {
          const manifest = await this.manifestFor(s);
          const d = digest(manifest, this.digestOpts(s, args));
          if (args.actions_only === true) {
            return buildEnvelope('ok', {
              session: s.id,
              page: pageRefOf(manifest),
              digest: { ...d, state: {} },
            });
          }
          return buildEnvelope('ok', { session: s.id, page: pageRefOf(manifest), digest: d });
        },
      );
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  private async persistHoldFromError(
    err: AppError,
    session: SessionFile,
    manifest: PageManifest,
    action: string,
    params: Record<string, unknown>,
  ): Promise<HoldSignal | null> {
    const rawBody =
      this.lastPost?.rawBody ??
      wouldBeBody(manifest, action, params, this.clientName, this.clientVersion);
    const postUrl = this.lastPost?.url ?? manifest.page.url;
    const common = {
      sessionId: session.id,
      action,
      page_url: manifest.page.url,
      page_version: manifest.page.version,
      post_url: postUrl,
      rawBody,
      idempotency_key: this.lastPost?.idempotencyKey ?? null,
      if_match_version: this.lastPost?.ifMatchVersion ?? manifest.page.version,
      origin: session.origin,
    };

    if (err.code === 'app.err.auth.challenge_required') {
      const ch = extractChallenge(err);
      if (!ch) return null;
      const file = persistChallengeHold(this.holds, {
        ...common,
        challengeDetails: ch,
      });
      return new HoldSignal(
        holdEnvelope(publicHoldFromFile(file), session.id, pageRefOf(manifest)),
      );
    }
    if (err.code === 'app.err.hold.human_required') {
      const h = extractHumanHold(err.envelope.error.details as Record<string, unknown> | undefined);
      const file = persistHumanHold(this.holds, {
        ...common,
        kind: 'human_verification',
        origin: session.origin,
        hold_token: h.id ?? null,
        verify_url: h.verify_url,
        widget_url: h.widget_url,
        ttl_ms: h.ttl_ms,
      });
      return new HoldSignal(
        holdEnvelope(publicHoldFromFile(file), session.id, pageRefOf(manifest)),
      );
    }
    if (err.code === 'app.err.consent.required') {
      const missing = err.envelope.error.details?.missing;
      const grant = Array.isArray(missing)
        ? (missing as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const file = this.holds.persist({
        ...common,
        kind: 'consent',
        grant,
      });
      return new HoldSignal(
        holdEnvelope(publicHoldFromFile(file), session.id, pageRefOf(manifest)),
      );
    }
    if (err.code === 'app.err.auth.required' || err.code === 'app.err.auth.expired') {
      const file = this.holds.persist({ ...common, kind: 'auth' });
      return new HoldSignal(
        holdEnvelope(publicHoldFromFile(file), session.id, pageRefOf(manifest)),
      );
    }
    if (err.code === 'app.err.action.confirmation_required') {
      const challenge =
        err.envelope.error.confirmation_challenge ??
        (err.envelope.error.details?.confirmation_challenge as { value?: string } | undefined)
          ?.value;
      assertNotUuidMode(challenge);
      const file = this.holds.persist({
        ...common,
        kind: 'confirmation',
        challenge: challenge ?? null,
      });
      return new HoldSignal(
        holdEnvelope(publicHoldFromFile(file), session.id, pageRefOf(manifest)),
      );
    }
    return null;
  }

  private actResult(
    action: string,
    result: InvokeResult,
    baseVersion: string,
    idempotencyKey: string | null,
    wait: boolean,
  ): { status: ToolEnvelope['status']; act: ActResult } {
    const resultVersion = result.manifest.page.version;
    let mode: ActResult['mode'] = 'full';
    let diff: unknown[] = [];
    let delta = {
      state_delta: {} as Record<string, unknown>,
      actions_delta: { added: [] as string[], removed: [] as string[], replaced: [] as string[] },
    };
    if (result.mode === 'diff' && result.document && isDiffDocument(result.document)) {
      mode = 'diff';
      const doc = result.document as DiffDocument;
      diff = doc.diff;
      delta = stateDelta(doc.diff, result.manifest);
    } else if (result.mode === 'redirect') {
      mode = 'redirect';
    } else if (result.mode === 'async') {
      mode = 'async';
    } else if (result.mode === 'full') {
      mode = 'full';
      const syn = stateDelta([], result.manifest);
      delta = {
        state_delta: result.manifest.state as unknown as Record<string, unknown>,
        actions_delta: syn.actions_delta,
      };
    }
    const act: ActResult = {
      action,
      mode,
      base_version: baseVersion,
      result_version: resultVersion,
      diff,
      state_delta: delta.state_delta,
      actions_delta: delta.actions_delta,
      navigation_effect: result.navigation_effect ?? null,
      idempotency_key: idempotencyKey,
    };
    let status: ToolEnvelope['status'] = 'ok';
    if (result.mode === 'redirect') status = 'navigated';
    if (result.mode === 'async') {
      const node = result.manifest.state?.operation_status as
        { value?: { state?: { value?: string } } } | undefined;
      const st = node?.value?.state?.value;
      if (!wait) status = 'async_pending';
      else if (
        st === 'failed' ||
        st === 'cancelled' ||
        result.manifest.error?.code === 'app.err.action.async_failed'
      ) {
        status = 'async_failed';
      } else status = 'async_succeeded';
    }
    return { status, act };
  }

  async act(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      const action = String(args.action ?? '');
      if (!action) {
        return errorEnvelope('app.err.tool.usage', 'Missing action');
      }
      refuseCompleteHold(action);
      if (typeof args.confirmation === 'string') assertNotUuidMode(args.confirmation);
      if (action === 'grant_consent') {
        return this.grantConsent(args);
      }
      const files = args.files as Array<{ param: string; path: string }> | undefined;
      if (Array.isArray(files)) {
        for (const f of files) {
          try {
            readFileSync(f.path);
          } catch {
            return errorEnvelope('app.err.tool.file_unreadable', `Cannot read ${f.path}`);
          }
        }
      }
      return await this.withSession(
        typeof args.session === 'string' ? args.session : null,
        async (s) => {
          const manifest = await this.manifestFor(s);
          const def = findAction(manifest, action);
          const auth = normalizeAuth(def.auth);
          if (auth === 'user') {
            const hold: Hold = {
              kind: 'auth',
              action,
              page_url: manifest.page.url,
              page_version: manifest.page.version,
              origin: s.origin,
              resume_hint: 'open login flow or set env credentials',
            };
            return holdEnvelope(hold, s.id, pageRefOf(manifest));
          }
          if (def.kind === 'delegate' && def.output?.delegate_protocol === 'https') {
            const file = this.holds.persist({
              sessionId: s.id,
              kind: 'delegate',
              action,
              page_url: manifest.page.url,
              page_version: manifest.page.version,
              post_url: manifest.page.url,
              rawBody: wouldBeBody(
                manifest,
                action,
                (args.params as Record<string, unknown>) ?? {},
                this.clientName,
                this.clientVersion,
              ),
              // K3 MF-9: surface delegates_to (hand-off target) and resume_url
              // (declared return URL, preferred over page.url).
              delegate: {
                url: def.output?.delegates_to ?? manifest.page.url,
                protocol: 'https',
                reason: def.description,
                resume_url: def.output?.resume_url ?? manifest.page.url,
              },
              origin: s.origin,
            });
            return holdEnvelope(publicHoldFromFile(file), s.id, pageRefOf(manifest));
          }

          const params = (args.params as Record<string, unknown>) ?? {};
          const wait = args.wait !== false && this.config.asyncWait;
          const invokeOpts: InvokeOptions = {
            skipPolicy: this.config.policyStrict !== true,
            skipNavigation: args.follow === false,
            conflictRetry: args.conflict_retry !== false,
            confirmation: typeof args.confirmation === 'string' ? args.confirmation : undefined,
            idempotencyKey:
              typeof args.idempotency_key === 'string' ? args.idempotency_key : undefined,
            asyncTimeoutMs: wait ? this.config.timeoutMs : 0,
          };
          const baseVersion = manifest.page.version;
          let result: InvokeResult;
          try {
            result = await this.client.invoke(manifest, action, params, invokeOpts);
          } catch (e) {
            if (e instanceof HoldSignal) return e.envelope;
            if (e instanceof AppError) {
              const hs = await this.persistHoldFromError(e, s, manifest, action, params);
              if (hs) return hs.envelope;
            }
            throw e;
          }
          if (result.mode === 'async' && wait === false) {
            /* accepted 202, do not poll further; dispatcher may have already polled if wait default */
          }
          if (
            result.mode === 'async' &&
            wait &&
            result.document &&
            isPageManifest(result.document)
          ) {
            result = {
              ...result,
              manifest: await pollAsyncOperationWithClient(
                this.client,
                result.document,
                invokeOpts,
              ),
            };
          }
          s = this.rememberManifest(s.id, result.manifest, s);
          const { status, act } = this.actResult(
            action,
            result,
            baseVersion,
            this.lastPost?.idempotencyKey ??
              (typeof args.idempotency_key === 'string' ? args.idempotency_key : null),
            wait,
          );
          const env: ToolEnvelope = buildEnvelope(status, {
            session: s.id,
            page: pageRefOf(result.manifest),
            act,
            request_id: result.request_id ?? null,
            meta: { warnings: [], negotiated_version: result.manifest.app },
          });
          if (status === 'navigated' || args.full === true) {
            env.digest = digest(result.manifest, this.digestOpts(s, args));
          }
          if (
            result.manifest.error &&
            isSoftErrorCode(result.manifest.error.code) &&
            args.full !== true
          ) {
            env.meta = {
              ...env.meta,
              warnings: [...(env.meta?.warnings ?? []), result.manifest.error.code],
            };
          }
          return env;
        },
      );
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  private async grantConsent(args: Record<string, unknown>): Promise<ToolEnvelope> {
    return this.withSession(typeof args.session === 'string' ? args.session : null, async (s) => {
      const file = this.holds.load(s.id);
      if (!file) {
        throw new AppError('app.err.tool.hold_mismatch', { message: 'No hold for grant_consent' });
      }
      resolveEarliestGate(file, 'grant_consent');
      const manifest = await this.manifestFor(s);
      const params = (args.params as Record<string, unknown>) ?? {};
      const result = await this.client.invoke(manifest, 'grant_consent', params, {
        skipPolicy: true,
      });
      const next = markGateCleared(file, 'consent');
      if (!next.gates.some((g) => g.status === 'pending'))
        this.holds.delete(s.id, file.body_sha256);
      else this.holds.writeFile(s.id, next);
      s = this.rememberManifest(s.id, result.manifest, s);
      const { status, act } = this.actResult(
        'grant_consent',
        result,
        manifest.page.version,
        null,
        true,
      );
      return buildEnvelope(status, { session: s.id, page: pageRefOf(result.manifest), act });
    });
  }

  async confirm(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      const decision = String(args.decision ?? '');
      if (decision !== 'approve' && decision !== 'reject') {
        return errorEnvelope('app.err.tool.usage', 'decision must be approve or reject');
      }
      if (typeof args.token === 'string') assertNotUuidMode(args.token);
      return await this.withSession(
        typeof args.session === 'string' ? args.session : null,
        async (s) => {
          const file = this.holds.load(s.id);
          if (!file) {
            throw new AppError('app.err.tool.hold_mismatch', { message: 'No matching hold' });
          }
          if (decision === 'reject') {
            this.holds.delete(s.id, file.body_sha256);
            return buildEnvelope('closed', {
              session: s.id,
              meta: { warnings: ['confirmation rejected; hold discarded'] },
            });
          }
          const gate = resolveEarliestGate(file, 'confirm');
          if (
            args.token &&
            file.challenge &&
            args.token !== file.challenge &&
            args.token !== gate.challenge
          ) {
            throw new AppError('app.err.action.confirmation_invalid', {
              message: 'Token does not match stored challenge',
            });
          }
          const extraHeaders: Record<string, string> = {};
          let confirmation: string | undefined;
          if (gate.kind === 'hold') {
            Object.assign(extraHeaders, holdTokenHeaders(file));
          } else if (!file.preflight) {
            confirmation =
              (typeof args.token === 'string' ? args.token : null) ?? file.challenge ?? undefined;
          }
          const posted = await this.holds.completeModeA(this.client.http, file, {
            confirmation,
            extraHeaders,
          });
          if (posted.meta.status === 409 || posted.meta.status === 403) {
            this.holds.delete(s.id, file.body_sha256);
            this.client.http.throwIfError(posted.body, posted.meta);
          }
          const cleared = markGateCleared(file, gate.kind);
          if (!cleared.gates.some((g) => g.status === 'pending'))
            this.holds.delete(s.id, file.body_sha256);
          else this.holds.writeFile(s.id, cleared);

          if (posted.meta.status >= 400) {
            this.client.http.throwIfError(posted.body, posted.meta);
          }
          const manifest = this.manifests.get(s.id);
          if (
            posted.meta.status === 303 ||
            posted.meta.status === 302 ||
            posted.meta.status === 301 ||
            posted.meta.status === 201
          ) {
            // Continued action navigated (C4): re-GET the target page like act().
            const nextUrl = requireNavigateLocation(
              posted.meta.location,
              posted.meta.navigate,
              file.page_url,
            );
            const nextM = await this.client.hydrate(nextUrl, { force: true });
            s = this.rememberManifest(s.id, nextM, s);
            return buildEnvelope('ok', {
              session: s.id,
              page: pageRefOf(nextM),
              act: {
                action: file.action,
                mode: 'redirect',
                base_version: file.page_version,
                result_version: nextM.page.version,
                diff: [],
                state_delta: nextM.state as unknown as Record<string, unknown>,
                actions_delta: { added: [], removed: [], replaced: [] },
                idempotency_key: file.idempotency_key,
              },
            });
          }
          if (isPageManifest(posted.body)) {
            const nextM = posted.body;
            s = this.rememberManifest(s.id, nextM, s);
            return buildEnvelope('ok', {
              session: s.id,
              page: pageRefOf(nextM),
              act: {
                action: file.action,
                mode: 'full',
                base_version: file.page_version,
                result_version: nextM.page.version,
                diff: [],
                state_delta: nextM.state as unknown as Record<string, unknown>,
                actions_delta: { added: [], removed: [], replaced: [] },
                idempotency_key: file.idempotency_key,
              },
            });
          }
          if (isDiffDocument(posted.body) && manifest) {
            const applied = this.client.applyDiff(manifest, posted.body);
            s = this.rememberManifest(s.id, applied, s);
            const delta = stateDelta(posted.body.diff, applied);
            return buildEnvelope('ok', {
              session: s.id,
              page: pageRefOf(applied),
              act: {
                action: file.action,
                mode: 'diff',
                base_version: file.page_version,
                result_version: applied.page.version,
                diff: posted.body.diff,
                state_delta: delta.state_delta,
                actions_delta: delta.actions_delta,
                idempotency_key: file.idempotency_key,
              },
            });
          }
          return buildEnvelope('ok', { session: s.id });
        },
      );
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  async challenge(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      const kind = String(args.kind ?? '');
      if (kind === 'human_verification' || kind === 'consent') {
        if (kind === 'consent') {
          return errorEnvelope('app.err.tool.usage', 'use act grant_consent');
        }
        refuseHumanVerificationChallengeSubmit(kind);
      }
      if (kind !== 'mfa' && kind !== 'otp' && kind !== 'abort') {
        return errorEnvelope('app.err.tool.usage', 'kind must be mfa, otp, or abort');
      }
      return await this.withSession(
        typeof args.session === 'string' ? args.session : null,
        async (s) => {
          if (kind === 'abort') {
            this.holds.delete(s.id);
            return buildEnvelope('closed', { session: s.id });
          }
          const manifest = await this.manifestFor(s);
          if (isPageStepOtp(manifest) && kind === 'otp') {
            const params: Record<string, unknown> = {};
            if (typeof args.value === 'string') params.otp = args.value;
            return this.act({ action: 'submit_otp', params, session: s.id });
          }
          const { file, result } = await submitChallengeContinuation(
            this.client.http,
            this.holds,
            s.id,
            {
              kind: kind === 'otp' ? 'otp' : 'mfa',
              value: typeof args.value === 'string' ? args.value : undefined,
            },
          );
          if (result.meta.status >= 400) {
            try {
              this.client.http.throwIfError(result.body, result.meta);
            } catch (e) {
              if (e instanceof AppError) {
                const kept = applyChallengeFailure(this.holds, s.id, e.code);
                if (e.code === 'app.err.auth.challenge_failed' && kept) {
                  return holdEnvelope(publicHoldFromFile(kept), s.id, pageRefOf(manifest));
                }
              }
              throw e;
            }
          }
          const cleared = markGateCleared(file, 'challenge');
          if (!cleared.gates.some((g) => g.status === 'pending'))
            this.holds.delete(s.id, file.body_sha256);
          else this.holds.writeFile(s.id, cleared);
          if (isPageManifest(result.body)) {
            s = this.rememberManifest(s.id, result.body, s);
          }
          return buildEnvelope('ok', {
            session: s.id,
            page: s.current
              ? { id: s.current.page_id, url: s.current.url, version: s.current.version }
              : undefined,
          });
        },
      );
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  async watch(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      return await this.withSession(
        typeof args.session === 'string' ? args.session : null,
        async (s) => {
          if (!s.current?.url) {
            throw new AppError('app.err.tool.session_missing', {
              message: 'No current page to watch',
            });
          }
          const features = featuresFromWellKnown(this.wellKnown.get(s.origin));
          const once = await watchOnce(this.client.http, s.current.url, {
            etag: s.current.etag,
            intervalMs: typeof args.interval_ms === 'number' ? args.interval_ms : undefined,
            refreshHintMs: intervalFromManifest(this.manifests.get(s.id)),
            features,
            sse: args.sse === true,
            ws: args.ws === true,
            lastEventId: s.watch?.last_event_id ?? null,
          });
          const watch = watchResultFromOnce(once);
          if (!once.changed) {
            return buildEnvelope('not_modified', {
              session: s.id,
              page: {
                id: s.current.page_id,
                url: s.current.url,
                version: s.current.version,
                etag: s.current.etag ?? undefined,
              },
              watch,
            });
          }
          if (once.manifest && isPageManifest(once.manifest)) {
            s = this.rememberManifest(s.id, once.manifest, s);
            return buildEnvelope('ok', {
              session: s.id,
              page: pageRefOf(once.manifest),
              digest: digest(once.manifest, this.digestOpts(s, args)),
              watch: { ...watch, changed: true },
            });
          }
          return buildEnvelope('ok', { session: s.id, watch: { ...watch, changed: true } });
        },
      );
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  async sessions(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      const op = String(args.op ?? 'list');
      this.store.gc();
      if (op === 'gc') {
        const deleted = this.store.gc();
        return buildEnvelope('ok', {
          session: this.getCurrentSessionId(),
          sessions: deleted.map((id) => ({ id, origin: '', updated_at: new Date().toISOString() })),
        });
      }
      if (op === 'list') {
        const list = this.listSessions();
        return buildEnvelope('ok', {
          session: this.getCurrentSessionId(),
          sessions: list as unknown as SessionSummary[],
        });
      }
      if (op === 'switch') {
        const id = String(args.session ?? '');
        this.store.switchCurrent(id);
        this.currentId = id;
        return (await this.getSessionDigest(id)) ?? buildEnvelope('ok', { session: id });
      }
      if (op === 'close') {
        const id = String(args.session ?? this.getCurrentSessionId() ?? '');
        this.store.deleteSession(id);
        if (this.currentId === id) this.currentId = this.store.readIndex().current;
        return buildEnvelope('closed', { session: this.currentId });
      }
      if (op === 'show') {
        const id = String(args.session ?? this.getCurrentSessionId() ?? '');
        const s = this.store.readSession(id);
        const hold = this.holds.load(id);
        return buildEnvelope('ok', {
          session: id,
          hold: hold ? publicHoldFromFile(hold) : null,
          digest: undefined,
          meta: { warnings: [] },
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
      }
      return errorEnvelope('app.err.tool.usage', `Unknown sessions op: ${op}`);
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  async logout(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      const origin =
        typeof args.origin === 'string'
          ? args.origin
          : this.getCurrentSessionId()
            ? this.store.readSession(this.getCurrentSessionId()!).origin
            : undefined;
      if (args.all === true) {
        this.store.resetAll();
        this.credentials.clearMemory();
        this.currentId = null;
        return buildEnvelope('closed', { meta: { warnings: ['reset all'] } });
      }
      if (origin) {
        this.store.deleteResume(origin);
        this.client.cache.invalidatePrivate();
        this.credentials.clearMemory();
      }
      return buildEnvelope('closed', {
        session: this.getCurrentSessionId(),
        meta: { warnings: origin ? [`private cache purged for ${origin}`] : [] },
      });
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }

  async reset(args: Record<string, unknown>): Promise<ToolEnvelope> {
    try {
      if (args.all === true) {
        this.store.resetAll();
        this.manifests.clear();
        this.currentId = null;
        return buildEnvelope('closed', { meta: { warnings: ['home reset'] } });
      }
      const id = typeof args.session === 'string' ? args.session : this.getCurrentSessionId();
      if (id) this.store.deleteSession(id);
      this.currentId = this.store.readIndex().current;
      return buildEnvelope('closed', { session: this.currentId });
    } catch (e) {
      return this.catchToEnvelope(e);
    }
  }
}

export function createRuntime(opts: CreateRuntimeOptions = {}): ToolRuntime {
  return new ToolRuntime(opts);
}
