/**
 * AgentRuntime / AgentClient — composes cache, hydrate, diff, policy, navigate, actions (§15.1, §25).
 */

import {
  ActionDispatcher,
  listActions,
  type OnConfirm,
  type OnChallenge,
  type OnConsent,
  type OnDelegate,
  type OnHold,
  type InvokeOptions,
} from './actions.js';
import { ManifestCache } from './cache.js';
import { applyDiff } from './diff.js';
import { AppError } from './errors.js';
import { emptyFeatureFlags, parseFeatures } from './features.js';
import {
  AppHttpClient,
  type AppResponseMeta,
  type FetchLike,
  type GetAuthHeaders,
  type OnAuthRefresh,
} from './http.js';
import { hydrate } from './hydrate.js';
import { expandNavigate, extractOrigin, NavigationStack } from './navigate.js';
import { ActionPolicy, type ActionPolicyOptions } from './policy.js';
import { prepareForPlanner, redactSecrets, stripForLlm } from './redact.js';
import { ResumeStore } from './resume.js';
import { HoldBudget } from './hold.js';
import {
  discoverOrigin,
  loginUrlFromError,
  runLogin,
  runLogout,
  runResume,
  type DiscoverResult,
  type IdentityHost,
} from './identity.js';
import {
  eventsUrlFrom,
  subscribeEvents,
  type EventSubscription,
  type SubscribeOptions,
} from './events.js';
import { TypeaheadController } from './typeahead.js';
import { uploadFile, type UploadBytes } from './upload.js';
import { downloadFile, type DownloadedFile } from './file.js';
import type {
  ActionDef,
  ActionSummary,
  DiffDocument,
  FeatureFlags,
  InvokeResult,
  PageManifest,
} from './types.js';

export interface AgentClientOptions {
  fetch?: FetchLike;
  getAuthHeaders?: GetAuthHeaders;
  onConfirm?: OnConfirm;
  onChallenge?: OnChallenge;
  onHold?: OnHold;
  onConsent?: OnConsent;
  onDelegate?: OnDelegate;
  onAuthRefresh?: OnAuthRefresh;
  policy?: ActionPolicy | ActionPolicyOptions;
  cache?: ManifestCache;
  clientName?: string;
  clientVersion?: string;
  /** Strict manifest receipt checks (§5.7): unknown members / node types rejected. */
  strict?: boolean;
}

export type { DiscoverResult, OnChallenge, OnHold, OnConsent, OnDelegate, EventSubscription };

/**
 * Reference agent client implementing SPEC §15 patterns.
 *
 * ```ts
 * const client = new AgentClient({
 *   getAuthHeaders: () => ({ Authorization: `Bearer ${token}` }),
 *   onAuthRefresh: async () => { token = await refresh(); return true; },
 *   onConfirm: async (req) => {
 *     // Echo challenge for agents (§10.4) — never client UUID
 *     if (req.challenge) return { approved: true, confirmationToken: req.challenge };
 *     return approveWithHuman(req);
 *   },
 * });
 * const m = await client.hydrate('https://example.com/search');
 * const { manifest } = await client.invoke(m.page.url, 'search', { q: 'LHR' });
 * ```
 */
export class AgentClient {
  readonly http: AppHttpClient;
  readonly cache: ManifestCache;
  readonly navStack: NavigationStack;
  readonly policy: ActionPolicy;
  readonly actions: ActionDispatcher;
  readonly resumeStore = new ResumeStore();
  readonly holdBudget = new HoldBudget();
  private issuedAccess?: string;
  private issuedRefresh?: string;
  private lastDiscover: DiscoverResult | null = null;
  private lastLoginUrl?: string;
  private readonly typeaheadCtl: TypeaheadController;
  private readonly strict: boolean;

  issuedTokens(): { access?: string; refresh?: string } {
    return { access: this.issuedAccess, refresh: this.issuedRefresh };
  }

  constructor(options: AgentClientOptions = {}) {
    this.strict = options.strict === true;
    this.cache = options.cache ?? new ManifestCache();
    this.navStack = new NavigationStack();
    this.policy =
      options.policy instanceof ActionPolicy
        ? options.policy
        : new ActionPolicy(options.policy ?? {});
    const userGetAuth = options.getAuthHeaders;
    this.http = new AppHttpClient({
      fetch: options.fetch,
      getAuthHeaders: async () => {
        const user = (await userGetAuth?.()) ?? {};
        if (this.issuedAccess && !user.Authorization) {
          return { ...user, Authorization: `Bearer ${this.issuedAccess}` };
        }
        return user;
      },
      onAuthRefresh: options.onAuthRefresh,
      getResumeToken: (url) => this.resumeStore.get(url),
      clientName: options.clientName,
      clientVersion: options.clientVersion,
      clientKind: 'agent',
    });
    this.actions = new ActionDispatcher({
      http: this.http,
      cache: this.cache,
      navStack: this.navStack,
      policy: this.policy,
      onConfirm: options.onConfirm,
      onChallenge: options.onChallenge,
      onHold: options.onHold,
      onConsent: options.onConsent,
      onDelegate: options.onDelegate,
      holdBudget: this.holdBudget,
      resume: this.resumeStore,
      onTokens: (meta, url) => this.captureTokens(meta, url),
      clientName: options.clientName,
      clientVersion: options.clientVersion,
    });
    this.typeaheadCtl = new TypeaheadController(this.actions);
  }

  private captureTokens(meta: AppResponseMeta, url: string): void {
    if (meta.setAppResume) this.resumeStore.applyHeader(url, meta.setAppResume);
    if (meta.accessToken) this.issuedAccess = meta.accessToken;
    if (meta.refreshToken) this.issuedRefresh = meta.refreshToken;
  }

  private identityHost(): IdentityHost {
    return {
      http: this.http,
      cache: this.cache,
      hydrate: {
        http: this.http,
        cache: this.cache,
        navStack: this.navStack,
        resume: this.resumeStore,
      },
      actions: this.actions,
      resume: this.resumeStore,
      captureTokens: (meta, url) => this.captureTokens(meta, url),
    };
  }

  private rememberAuthError(err: unknown): void {
    if (err instanceof AppError) {
      const loginUrl = loginUrlFromError(err);
      if (loginUrl) this.lastLoginUrl = loginUrl;
    }
  }

  /** §15.3 Manifest hydration with freshness / If-None-Match. */
  async hydrate(
    url: string,
    opts?: { force?: boolean; bypassCache?: boolean; fromPageUrl?: string; resumeToken?: string },
  ): Promise<PageManifest> {
    try {
      return await hydrate(
        { http: this.http, cache: this.cache, navStack: this.navStack, resume: this.resumeStore },
        url,
        { ...opts, strict: this.strict },
      );
    } catch (err) {
      this.rememberAuthError(err);
      throw err;
    }
  }

  /**
   * Invoke an action by page URL (re-hydrates if needed) or against a known manifest.
   * Serializes non-idempotent actions per page mutex (§15.6).
   */
  async invoke(
    urlOrManifest: string | PageManifest,
    action: string,
    params: Record<string, unknown> = {},
    opts?: InvokeOptions,
  ): Promise<InvokeResult> {
    const manifest =
      typeof urlOrManifest === 'string' ? await this.hydrate(urlOrManifest) : urlOrManifest;
    try {
      return await this.actions.invoke(manifest, action, params, opts);
    } catch (err) {
      this.rememberAuthError(err);
      throw err;
    }
  }

  /** §7.3 / §15.4 — apply RFC6902 diff atomically with version check. */
  applyDiff(manifest: PageManifest, diffDoc: DiffDocument): PageManifest {
    const next = applyDiff(manifest, diffDoc);
    this.cache.set(next.page.url, next, { etag: next.page.etag });
    return next;
  }

  /** §8.3 URL template expand with same-origin check. */
  expandNavigate(actionDef: ActionDef, params: Record<string, unknown>, baseUrl: string): string {
    return expandNavigate(actionDef, params, baseUrl);
  }

  /** §15.5 Action selection helper — list actions for planner. */
  listActions(manifest: PageManifest): ActionSummary[] {
    return listActions(manifest);
  }

  /** §15.7 Token budget: strip present + redact secrets. */
  forPlanner(manifest: PageManifest, topK = 5): Omit<PageManifest, 'present'> {
    return prepareForPlanner(manifest, topK);
  }

  stripPresent(manifest: PageManifest): Omit<PageManifest, 'present'> {
    return stripForLlm(manifest);
  }

  redact(manifest: PageManifest): PageManifest {
    return redactSecrets(manifest);
  }

  features(): FeatureFlags {
    return this.lastDiscover?.features ?? emptyFeatureFlags();
  }

  async discover(origin: string): Promise<DiscoverResult> {
    const result = await discoverOrigin(this.identityHost(), origin);
    this.lastDiscover = result;
    return result;
  }

  async login(origin: string, params: Record<string, unknown> = {}): Promise<InvokeResult> {
    const loginUrl =
      this.lastLoginUrl && originOfUrl(this.lastLoginUrl) === originOfUrl(origin)
        ? this.lastLoginUrl
        : undefined;
    const result = await runLogin(this.identityHost(), origin, params, { loginUrl });
    return result;
  }

  async logout(
    origin: string,
    params: Record<string, unknown> = {},
  ): Promise<InvokeResult | PageManifest> {
    const result = await runLogout(this.identityHost(), origin, params);
    this.cache.purgeOnLogout(origin.replace(/\/$/, ''));
    this.resumeStore.clear(origin);
    this.issuedAccess = undefined;
    this.issuedRefresh = undefined;
    this.lastLoginUrl = undefined;
    return result;
  }

  async resumeSession(origin: string, token: string, pageUrl?: string): Promise<PageManifest> {
    return runResume(this.identityHost(), origin, token, pageUrl);
  }

  /** SPEC §25.2 `resume(origin, token)` - GET with X-APP-Resume. */
  async resume(origin: string, token: string, pageUrl?: string): Promise<PageManifest> {
    return this.resumeSession(origin, token, pageUrl);
  }

  async subscribe(
    pageUrl: string,
    options: {
      onEvent: SubscribeOptions['onEvent'];
      types?: string[];
      mode?: SubscribeOptions['mode'];
    },
  ): Promise<EventSubscription> {
    let eventsUrl = this.lastDiscover?.eventsUrl;
    let page: PageManifest | undefined;
    try {
      page = await this.hydrate(pageUrl);
      eventsUrl = eventsUrlFrom(page) ?? eventsUrl;
    } catch {
      /* well-known events_url may still work */
    }
    if (!eventsUrl && this.lastDiscover == null) {
      try {
        const origin = extractOrigin(pageUrl);
        const d = await this.discover(origin);
        eventsUrl = d.eventsUrl;
      } catch {
        /* fall through */
      }
    }
    const flags = page ? parseFeatures(page) : this.features();
    const mode =
      options.mode ?? (flags.events_sse ? 'sse' : flags.events_longpoll ? 'longpoll' : 'auto');
    return subscribeEvents(this.http, pageUrl, {
      onEvent: options.onEvent,
      eventsUrl,
      types: options.types,
      mode,
    });
  }

  async typeahead(
    manifest: PageManifest,
    action: string,
    param: string,
    q: string,
  ): Promise<{ sent: boolean; query: string; manifest?: PageManifest }> {
    return this.typeaheadCtl.query(manifest, action, param, q, {
      features: this.lastDiscover?.features ?? parseFeatures(manifest),
    });
  }

  async uploadFile(
    manifest: PageManifest,
    action: string,
    file: UploadBytes,
  ): Promise<{ receipt?: import('./upload.js').UploadReceipt; manifest: PageManifest }> {
    return uploadFile({ http: this.http, dispatcher: this.actions }, manifest, action, file);
  }

  /**
   * Download a file-node's bytes. On 401/403 revalidates the parent manifest
   * fresh and retries once (v0.4 §5.2); verifies sha256 when declared.
   */
  async downloadFile(
    manifestOrUrl: PageManifest | string,
    nodeKey: string,
  ): Promise<DownloadedFile> {
    const manifest =
      typeof manifestOrUrl === 'string' ? await this.hydrate(manifestOrUrl) : manifestOrUrl;
    return downloadFile(
      { http: this.http, hydrate: (url, opts) => this.hydrate(url, opts) },
      manifest,
      nodeKey,
    );
  }

  async invokeBulk(
    manifest: PageManifest,
    action: string,
    items: unknown[],
    opts?: InvokeOptions,
  ): Promise<InvokeResult> {
    return this.actions.invokeBulk(manifest, action, items, opts);
  }
}

function originOfUrl(url: string): string {
  try {
    return extractOrigin(url);
  } catch {
    return url.replace(/\/$/, '');
  }
}

/** Alias matching §15.1 architecture diagram. */
export { AgentClient as AgentRuntime };

/**
 * Documented Search → Filter → Book flow (§15.8).
 *
 * ```
 * m = hydrate(searchUrl)
 * post(m, "search", params) → navigate → m2
 * post(m2, "filter", {max_price}) → applyDiff
 * post(m2, "select_flight", {flight_id}) → navigate → m3
 * approve(financial)
 * post(m3, "confirm_booking", piiParams, confirmation)
 * ```
 */
export async function searchFilterBook(
  client: AgentClient,
  opts: {
    searchUrl: string;
    searchParams: Record<string, unknown>;
    filterParams: Record<string, unknown>;
    flightId: string;
    bookingParams: Record<string, unknown>;
    searchAction?: string;
    filterAction?: string;
    selectAction?: string;
    confirmAction?: string;
  },
): Promise<PageManifest> {
  const searchAction = opts.searchAction ?? 'search';
  const filterAction = opts.filterAction ?? 'filter';
  const selectAction = opts.selectAction ?? 'select_flight';
  const confirmAction = opts.confirmAction ?? 'confirm_booking';

  let m = await client.hydrate(opts.searchUrl);
  const afterSearch = await client.invoke(m, searchAction, opts.searchParams);
  m = afterSearch.manifest;

  const afterFilter = await client.invoke(m, filterAction, opts.filterParams);
  m = afterFilter.manifest;

  const afterSelect = await client.invoke(m, selectAction, { flight_id: opts.flightId });
  m = afterSelect.manifest;

  const afterBook = await client.invoke(m, confirmAction, opts.bookingParams);
  return afterBook.manifest;
}
