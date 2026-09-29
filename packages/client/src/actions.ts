/**
 * Action dispatch — confirmation Mode A, async Form D, navigate C4, idempotency
 * (SPEC v0.4-Ultimate §6, §10.4, §15).
 */

import { randomBytes } from 'node:crypto';
import { applyDiffDocument, isDiffDocument, isPageManifest } from './diff.js';
import { AppError } from './errors.js';
import type { AppHttpClient, AppResponseMeta } from './http.js';
import { MEDIA_DIFF, MEDIA_ERROR, MEDIA_PAGE } from './media-types.js';
import {
  assertSameOrigin,
  canNavigateWithoutPost,
  expandNavigate,
  extractOrigin,
  isSameOrigin,
  NavigationStack,
  requireNavigateLocation,
  resolveAppUrl,
} from './navigate.js';
import {
  ActionPolicy,
  isIdempotentAction,
  policyLevelFor,
  readAmountFromState,
  requiresIdempotencyKey,
} from './policy.js';
import type { ManifestCache } from './cache.js';
import { hydrate } from './hydrate.js';
import {
  assertChallengeBudget,
  challengeFromErrorDetails,
  collectChallenge,
  type OnChallenge,
} from './challenge.js';
import {
  assertNotCompleteHold,
  collectHold,
  holdDeadlineMs,
  holdFromErrorDetails,
  holdFromManifest,
  holdPollIntervalMs,
  HoldBudget,
  type OnHold,
} from './hold.js';
import { collectConsent, missingConsentPurposes, parseConsent, type OnConsent } from './consent.js';
import { unwrapStateNode } from './features.js';
import type { ResumeStore } from './resume.js';
import type {
  ActionDef,
  ActionRequest,
  ActionSummary,
  ConfirmationRequest,
  DiffDocument,
  InvokeResult,
  OperationStatusState,
  PageManifest,
  StateNode,
} from './types.js';
import { APP_VERSION } from './media-types.js';

export type OnDelegate = (req: {
  url: string;
  origin: string;
  sideEffect: string;
}) => Promise<{ opened: boolean }>;

export type { OnChallenge, OnHold, OnConsent };

export type OnConfirm = (
  req: ConfirmationRequest,
) => Promise<boolean | { approved: boolean; confirmationToken?: string }>;

export interface InvokeOptions {
  /** Explicit confirmation token (challenge echo). */
  confirmation?: string;
  /** Explicit idempotency key. */
  idempotencyKey?: string;
  /** Skip policy gate (caller already approved). */
  skipPolicy?: boolean;
  /** Do not follow navigation_effect / 303. */
  skipNavigation?: boolean;
  /** Retry once on 409 conflict after re-GET (§7.4). */
  conflictRetry?: boolean;
  /** Max async poll wall-clock ms (default 120_000). */
  asyncTimeoutMs?: number;
  challenge?: string;
  holdToken?: string;
}

export interface ActionDispatcherOptions {
  http: AppHttpClient;
  cache: ManifestCache;
  navStack: NavigationStack;
  policy: ActionPolicy;
  onConfirm?: OnConfirm;
  onChallenge?: OnChallenge;
  onHold?: OnHold;
  onConsent?: OnConsent;
  onDelegate?: OnDelegate;
  holdBudget?: HoldBudget;
  resume?: ResumeStore;
  onTokens?: (meta: AppResponseMeta, url: string) => void;
  clientName?: string;
  clientVersion?: string;
}

/** Per-page mutex queue (§6.8 / §15.6). */
export class PageMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(
    pageUrl: string,
    fn: () => Promise<T>,
    opts?: { requireExclusive?: boolean },
  ): Promise<T> {
    const key = pageUrl;
    const exclusive = opts?.requireExclusive ?? true;
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const tail = prev.then(() => gate);
    this.tails.set(key, exclusive ? tail.catch(() => undefined) : prev.catch(() => undefined));

    if (exclusive) {
      await prev.catch(() => undefined);
    }

    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function generateIdempotencyKey(): string {
  return `idem_${randomBytes(16).toString('base64url')}`;
}

export function listActions(manifest: PageManifest): ActionSummary[] {
  const actions = manifest.actions ?? {};
  return Object.entries(actions).map(([id, def]) => ({
    id,
    description: def.description,
    kind: def.kind,
    side_effect: def.side_effect ?? 'safe',
    requires_confirmation: !!def.requires_confirmation,
    idempotent: isIdempotentAction(def),
    auth: def.auth ?? 'none',
    inputKeys: Object.keys(def.input ?? {}),
    param_mode: def.param_mode ?? 'strict',
    requires_etag_match: !!def.requires_etag_match,
  }));
}

export function findAction(manifest: PageManifest, actionId: string): ActionDef {
  const def = manifest.actions?.[actionId];
  if (!def) {
    throw new AppError('app.err.action.not_found', {
      message: `Action not found: ${actionId}`,
    });
  }
  return def;
}

function actionPostUrl(manifest: PageManifest, actionDef: ActionDef): string {
  const raw = actionDef.action_url || manifest.page.url;
  const url = resolveAppUrl(raw, manifest.page.url);
  assertSameOrigin(url, manifest.page.url);
  return url;
}

function buildActionRequest(
  manifest: PageManifest,
  actionId: string,
  params: Record<string, unknown>,
  client: { name?: string; version?: string },
): ActionRequest {
  return {
    app: manifest.app === '1.1' ? '1.1' : APP_VERSION,
    action: actionId,
    params,
    client: {
      kind: 'agent',
      name: client.name ?? 'agent-page-client',
      version: client.version ?? '0.4.0',
    },
    context: {
      page_id: manifest.page.id,
      page_url: manifest.page.url,
      manifest_version: manifest.page.version,
    },
  };
}

function getConfirmationChallenge(err: AppError): string | undefined {
  return (
    err.envelope.error.confirmation_challenge ??
    (err.envelope.error.details?.confirmation_challenge as { value?: string } | undefined)?.value
  );
}

function readOperationStatus(manifest: PageManifest): {
  state: OperationStatusState;
  statusUrl?: string;
  progress?: number;
} | null {
  const node = manifest.state?.operation_status as StateNode | undefined;
  if (!node || node.type !== 'object') return null;
  const value = (node as { value: Record<string, StateNode> }).value ?? {};
  const stateNode = value.state as { type?: string; value?: string } | undefined;
  const urlNode = value.status_url as { type?: string; value?: string } | undefined;
  const progressNode = value.progress as { type?: string; value?: number } | undefined;
  if (!stateNode?.value) return null;
  return {
    state: stateNode.value as OperationStatusState,
    statusUrl: typeof urlNode?.value === 'string' ? urlNode.value : undefined,
    progress: typeof progressNode?.value === 'number' ? progressNode.value : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ActionDispatcher {
  private readonly http: AppHttpClient;
  private readonly cache: ManifestCache;
  private readonly navStack: NavigationStack;
  private readonly policy: ActionPolicy;
  private readonly onConfirm?: OnConfirm;
  private readonly onChallenge?: OnChallenge;
  private readonly onHold?: OnHold;
  private readonly onConsent?: OnConsent;
  private readonly onDelegate?: OnDelegate;
  readonly holdBudget: HoldBudget;
  private readonly resume?: ResumeStore;
  private readonly onTokens?: (meta: AppResponseMeta, url: string) => void;
  private readonly clientName?: string;
  private readonly clientVersion?: string;
  readonly mutex = new PageMutex();
  /** Consecutive factor challenges per meta.flow id (§6 nested-challenge budget). */
  private readonly factorSteps = new Map<string, number>();

  constructor(options: ActionDispatcherOptions) {
    this.http = options.http;
    this.cache = options.cache;
    this.navStack = options.navStack;
    this.policy = options.policy;
    this.onConfirm = options.onConfirm;
    this.onChallenge = options.onChallenge;
    this.onHold = options.onHold;
    this.onConsent = options.onConsent;
    this.onDelegate = options.onDelegate;
    this.holdBudget = options.holdBudget ?? new HoldBudget();
    this.resume = options.resume;
    this.onTokens = options.onTokens;
    this.clientName = options.clientName;
    this.clientVersion = options.clientVersion;
  }

  private hydrateCtx() {
    return { http: this.http, cache: this.cache, navStack: this.navStack, resume: this.resume };
  }

  private captureTokens(meta: AppResponseMeta, url: string): void {
    if (meta.setAppResume) this.resume?.applyHeader(url, meta.setAppResume);
    this.onTokens?.(meta, url);
  }

  /**
   * Policy gate + optional onConfirm. For agents, confirmation uses 428 Mode A only (§10.4).
   */
  async ensureAllowed(
    actionId: string,
    actionDef: ActionDef,
    params: Record<string, unknown>,
    manifest: PageManifest,
  ): Promise<string | undefined> {
    const decision = this.policy.evaluate(actionId, actionDef, params, manifest);
    if (decision.allowed) return undefined;

    if (!this.onConfirm) {
      this.policy.deny(actionId, `Confirmation required at ${decision.confirmation.level}`);
    }

    const result = await this.onConfirm!(decision.confirmation);
    const approved = typeof result === 'boolean' ? result : result.approved;
    if (!approved) {
      this.policy.deny(actionId, 'User/agent rejected confirmation');
    }
    if (typeof result === 'object' && result.confirmationToken) {
      // Reject Mode B uuid for agents
      if (result.confirmationToken.startsWith('uuid-mode:')) {
        throw new AppError('app.err.action.confirmation_invalid', {
          message: 'Agents must not use Mode B uuid-mode confirmation',
        });
      }
      return result.confirmationToken;
    }
    return undefined;
  }

  private async handleConfirmationChallenge(
    err: AppError,
    actionId: string,
    actionDef: ActionDef,
    params: Record<string, unknown>,
    manifest: PageManifest,
  ): Promise<string> {
    const challenge = getConfirmationChallenge(err);
    if (!challenge) {
      throw err;
    }
    if (challenge.startsWith('uuid-mode:')) {
      throw new AppError('app.err.action.confirmation_invalid', {
        message: 'Agents must not use Mode B uuid-mode confirmation',
      });
    }
    if (!this.onConfirm) {
      throw err;
    }
    const level = policyLevelFor(actionDef);
    const confResult = await this.onConfirm({
      actionId,
      actionDef,
      params,
      manifest,
      level: level === 'L0' ? 'L4' : level,
      challenge,
      amount: readAmountFromState(manifest, actionDef.confirm?.amount_path),
    });
    const approved = typeof confResult === 'boolean' ? confResult : confResult.approved;
    if (!approved) {
      this.policy.deny(actionId, 'Confirmation challenge rejected');
    }
    // Mode A: echo the server challenge — never invent UUID
    if (typeof confResult === 'object' && confResult.confirmationToken) {
      if (confResult.confirmationToken.startsWith('uuid-mode:')) {
        throw new AppError('app.err.action.confirmation_invalid', {
          message: 'Agents must not use Mode B uuid-mode confirmation',
        });
      }
      return confResult.confirmationToken;
    }
    return challenge;
  }

  private cacheManifest(manifest: PageManifest): void {
    this.cache.set(manifest.page.url, manifest, {
      etag: manifest.page.etag,
    });
  }

  /**
   * Form D async poll (§6.9 / TV-50 / TV-51). Public for tool-core watch (K3 MF-7).
   */
  async pollAsyncOperation(accepted: PageManifest, options: InvokeOptions): Promise<PageManifest> {
    const status = readOperationStatus(accepted);
    if (!status?.statusUrl) {
      throw new AppError('app.err.manifest.invalid', {
        message: 'Async Form D missing operation_status.status_url',
      });
    }
    const statusUrl = resolveAppUrl(status.statusUrl, accepted.page.url);
    assertSameOrigin(statusUrl, accepted.page.url);

    const pollInterval = Math.max(
      500,
      typeof accepted.meta?.poll_interval_ms === 'number'
        ? (accepted.meta.poll_interval_ms as number)
        : 2000,
    );
    const timeoutMs =
      options.asyncTimeoutMs ??
      (typeof accepted.meta?.refresh_hint_ms === 'number'
        ? (accepted.meta.refresh_hint_ms as number)
        : 120_000);

    const deadline = Date.now() + timeoutMs;
    let wait = pollInterval;
    let current: typeof accepted;

    while (Date.now() < deadline) {
      await sleep(wait);
      current = await hydrate(this.hydrateCtx(), statusUrl, {
        fromPageUrl: accepted.page.url,
        expectedPageUrl: accepted.page.url,
        force: true,
        bypassCache: true,
      });
      const op = readOperationStatus(current);
      if (!op) {
        // Status doc without node — treat as succeeded with final state
        this.cacheManifest(current);
        return current;
      }
      if (op.state === 'succeeded') {
        this.cacheManifest(current);
        return current;
      }
      if (op.state === 'failed' || op.state === 'cancelled') {
        // Soft async_failed (TV-51)
        if (!current.error) {
          current = {
            ...current,
            error: {
              code: 'app.err.action.async_failed',
              message:
                op.state === 'cancelled' ? 'Async operation cancelled' : 'Async operation failed',
            },
          };
        } else if (!current.error.code) {
          current.error.code = 'app.err.action.async_failed';
        }
        this.cacheManifest(current);
        return current;
      }
      // Still queued/running — exponential backoff on repeated polls, floor = poll_interval
      wait = Math.min(30_000, Math.max(pollInterval, wait * 1.5));
      const nextInterval =
        typeof current.meta?.poll_interval_ms === 'number'
          ? Math.max(500, current.meta.poll_interval_ms as number)
          : pollInterval;
      wait = Math.max(nextInterval, wait);
    }

    throw new AppError('app.err.transport.timeout', {
      message: 'Async operation polling timed out',
    });
  }

  private async applyResponse(
    manifest: PageManifest,
    meta: AppResponseMeta,
    body: unknown,
    options: InvokeOptions,
    actionDef?: ActionDef,
  ): Promise<InvokeResult> {
    // Form C — Navigate via 303/201 (C4 / TV-37–39)
    if (meta.status === 303 || meta.status === 201) {
      const nextUrl = requireNavigateLocation(meta.location, meta.navigate, manifest.page.url);
      if (actionDef?.kind === 'delegate' && !isSameOrigin(nextUrl, manifest.page.url)) {
        await this.openDelegate({
          ...actionDef,
          output: { ...actionDef.output, delegates_to: nextUrl },
        });
        return {
          manifest,
          mode: 'redirect',
          document: null,
          navigation_effect: { url: nextUrl, mode: 'replace' },
          request_id: meta.requestId ?? undefined,
        };
      }
      if (!options.skipNavigation) {
        // ALWAYS re-GET Location with full APP Accept (TV-38)
        const next = await hydrate(this.hydrateCtx(), nextUrl, {
          fromPageUrl: manifest.page.url,
          force: true,
          bypassCache: true,
        });
        // 201 with body: if body present and valid, could use directly — but we still GET for consistency
        // Spec: if body present, client MAY use it if page.url == Location; we prefer GET for header fidelity
        if (meta.status === 201 && isPageManifest(body)) {
          const embedded = body as PageManifest;
          try {
            if (resolveAppUrl(embedded.page.url, nextUrl) === resolveAppUrl(nextUrl, nextUrl)) {
              this.cacheManifest(embedded);
              return {
                manifest: embedded,
                mode: 'redirect',
                document: embedded,
                request_id: meta.requestId ?? undefined,
              };
            }
          } catch {
            /* fall through to GET result */
          }
        }
        return {
          manifest: next,
          mode: 'redirect',
          document: null,
          request_id: meta.requestId ?? undefined,
        };
      }
      return {
        manifest,
        mode: 'redirect',
        document: null,
        navigation_effect: { url: nextUrl, mode: 'replace' },
        request_id: meta.requestId ?? undefined,
      };
    }

    // Navigate action returning 200 + body = protocol violation (TV-37)
    if (actionDef?.kind === 'navigate' && meta.status === 200 && body != null) {
      throw new AppError('app.err.manifest.invalid', {
        message: 'Navigate action must not return 200 with body (C4)',
        request_id: meta.requestId ?? undefined,
      });
    }

    // Form D — Async Accepted (TV-50)
    if (meta.status === 202 || meta.responseMode === 'async') {
      if (!isPageManifest(body)) {
        throw new AppError('app.err.manifest.invalid', {
          message: 'Async Form D requires a Page Manifest body',
          request_id: meta.requestId ?? undefined,
        });
      }
      const accepted = body as PageManifest;
      this.cacheManifest(accepted);
      const final = await this.pollAsyncOperation(accepted, options);
      return {
        manifest: final,
        mode: 'async',
        document: accepted,
        request_id: meta.requestId ?? undefined,
      };
    }

    if (meta.mediaType === MEDIA_DIFF || isDiffDocument(body)) {
      if (!isDiffDocument(body)) {
        throw new AppError('app.err.manifest.invalid', {
          message: 'Expected Diff Document',
          request_id: meta.requestId ?? undefined,
        });
      }
      const diffDoc = body as DiffDocument;
      // Prefer X-APP-Result-Version when present
      if (meta.resultVersion && meta.resultVersion !== diffDoc.result_version) {
        // Header awareness: trust body result_version but note drift is a server bug;
        // use body as authoritative for apply.
      }
      const applied = applyDiffDocument(manifest, diffDoc);
      if (!applied.ok) {
        throw new AppError(applied.code, {
          message: applied.message,
          request_id: meta.requestId ?? undefined,
        });
      }
      this.cacheManifest(applied.manifest);

      if (applied.navigation_effect && !options.skipNavigation) {
        const next = await hydrate(this.hydrateCtx(), applied.navigation_effect.url, {
          fromPageUrl: applied.manifest.page.url,
          force: true,
          bypassCache: true,
        });
        return {
          manifest: next,
          mode: 'diff',
          document: diffDoc,
          navigation_effect: applied.navigation_effect,
          request_id: meta.requestId ?? undefined,
        };
      }

      return {
        manifest: applied.manifest,
        mode: 'diff',
        document: diffDoc,
        navigation_effect: applied.navigation_effect,
        request_id: meta.requestId ?? undefined,
      };
    }

    if (meta.mediaType === MEDIA_PAGE || isPageManifest(body)) {
      const full = body as PageManifest;
      if (!isPageManifest(full)) {
        throw new AppError('app.err.manifest.invalid', {
          request_id: meta.requestId ?? undefined,
        });
      }
      if (meta.resultVersion && full.page.version !== meta.resultVersion) {
        // Prefer header when body drifts (awareness)
        full.page.version = meta.resultVersion;
      }
      this.cacheManifest(full);
      return {
        manifest: full,
        mode: 'full',
        document: full,
        request_id: meta.requestId ?? undefined,
      };
    }

    throw new AppError('app.err.negotiate.not_acceptable', {
      message: `Unexpected action response type: ${meta.mediaType}`,
      httpStatus: 406,
      request_id: meta.requestId ?? undefined,
    });
  }

  async invoke(
    manifest: PageManifest,
    actionId: string,
    params: Record<string, unknown> = {},
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const actionDef = findAction(manifest, actionId);
    const pageUrl = manifest.page.url;
    const exclusive = !isIdempotentAction(actionDef);

    return this.mutex.run(
      pageUrl,
      () => this.invokeUnlocked(manifest, actionId, actionDef, params, options),
      { requireExclusive: exclusive },
    );
  }

  async invokeBulk(
    manifest: PageManifest,
    actionId: string,
    items: unknown[],
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const actionDef = findAction(manifest, actionId);
    const max = actionDef.bulk?.max_items ?? 50;
    if (items.length > max) {
      throw new AppError('app.err.validation.param_range', {
        message: `Bulk items exceed max_items=${max}`,
      });
    }
    return this.invoke(manifest, actionId, { items }, options);
  }

  private async invokeUnlocked(
    manifest: PageManifest,
    actionId: string,
    actionDef: ActionDef,
    params: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<InvokeResult> {
    assertNotCompleteHold(actionId);

    if (actionDef.kind === 'delegate' && !this.onDelegate) {
      throw new AppError('app.err.auth.delegate_unattended', {
        message: 'Agents without onDelegate must not follow IdP URLs',
      });
    }

    // Safe navigate shortcut (§8.4)
    if (canNavigateWithoutPost(actionDef, params)) {
      const url = expandNavigate(actionDef, params, manifest.page.url);
      const next = await hydrate(this.hydrateCtx(), url, {
        fromPageUrl: manifest.page.url,
        force: true,
      });
      return { manifest: next, mode: 'redirect', document: null };
    }

    let confirmation = options.confirmation;
    if (!options.skipPolicy) {
      const fromPolicy = await this.ensureAllowed(actionId, actionDef, params, manifest);
      confirmation = confirmation ?? fromPolicy;
    }

    let idempotencyKey = options.idempotencyKey;
    if (requiresIdempotencyKey(actionDef) && !idempotencyKey) {
      idempotencyKey = generateIdempotencyKey();
    }

    const postUrl = actionPostUrl(manifest, actionDef);
    const requestBody = buildActionRequest(manifest, actionId, params, {
      name: this.clientName,
      version: this.clientVersion,
    });

    // Serialize ONCE — Mode A confirmation re-POST must use identical raw bytes (C10 / TV-45)
    const rawBody = JSON.stringify(requestBody);

    const ifMatch =
      actionDef.requires_etag_match || manifest.page.version ? manifest.page.version : undefined;

    type PostExtra = {
      conf?: string;
      challenge?: string;
      holdToken?: string;
      raw?: string;
      body?: ActionRequest;
    };
    const doPost = async (extra: PostExtra = {}) =>
      this.http.postAction(postUrl, extra.body ?? requestBody, {
        pageUrl: manifest.page.url,
        ifMatchVersion: ifMatch,
        idempotencyKey,
        confirmation: extra.conf,
        rawBody: extra.raw ?? rawBody,
        challenge: extra.challenge ?? options.challenge,
        holdToken: extra.holdToken ?? options.holdToken,
        resumeToken: this.resume?.get(manifest.page.url),
      });

    let { meta, body } = await doPost({ conf: confirmation });
    this.captureTokens(meta, postUrl);

    let challengeContinuations = 0;
    let consentRetried = false;

    // §6 nested-challenge budget: factor steps accumulate across the invokes of
    // one meta.flow; step_count declares chains longer than the 2-step default.
    const flow = manifest.meta?.flow;
    const flowMeta = flow && typeof flow === 'object' ? (flow as Record<string, unknown>) : null;
    const flowKey = typeof flowMeta?.id === 'string' ? flowMeta.id : manifest.page.url;
    const declaredStepCount =
      typeof flowMeta?.step_count === 'number' && Number.isInteger(flowMeta.step_count)
        ? flowMeta.step_count
        : undefined;

    for (let i = 0; i < 5; i++) {
      if (meta.status === 428 || (meta.mediaType === MEDIA_ERROR && isAppErrorBody(body))) {
        try {
          this.http.throwIfError(body, meta);
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          if (e.code === 'app.err.auth.challenge_required') {
            challengeContinuations += 1;
            if (flowMeta?.step_index === 1) this.factorSteps.delete(flowKey);
            const factorStep = (this.factorSteps.get(flowKey) ?? 0) + 1;
            this.factorSteps.set(flowKey, factorStep);
            assertChallengeBudget(factorStep, declaredStepCount);
            if (challengeContinuations > 1) {
              throw new AppError('app.err.auth.challenge_invalid', {
                message: 'A given idempotency key admits at most one challenge continuation',
              });
            }
            const challenge = challengeFromErrorDetails(e.envelope.error.details);
            if (!challenge) throw e;
            const collected = await collectChallenge(this.onChallenge, {
              challenge,
              actionId,
              params,
              manifest,
            });
            const paramName = challenge.param ?? 'otp';
            const nextParams = { ...params };
            if (collected.otp !== undefined) nextParams[paramName] = collected.otp;
            if (collected.credential !== undefined) nextParams.credential = collected.credential;
            const continued = buildActionRequest(manifest, actionId, nextParams, {
              name: this.clientName,
              version: this.clientVersion,
            });
            ({ meta, body } = await doPost({
              conf: confirmation,
              challenge: challenge.id,
              body: continued,
              raw: JSON.stringify(continued),
            }));
            this.captureTokens(meta, postUrl);
            continue;
          }
          if (e.code === 'app.err.hold.human_required') {
            this.holdBudget.record();
            const hold = holdFromErrorDetails(e.envelope.error.details);
            if (!hold) throw e;
            const collected = await collectHold(this.onHold, {
              hold,
              actionId,
              params,
              manifest,
            });
            if (collected.wait) {
              await this.waitForHoldCleared(hold, manifest);
            }
            ({ meta, body } = await doPost({
              conf: confirmation,
              holdToken: collected.token,
            }));
            this.captureTokens(meta, postUrl);
            continue;
          }
          if (e.code === 'app.err.action.confirmation_required') {
            const token = await this.handleConfirmationChallenge(
              e,
              actionId,
              actionDef,
              params,
              manifest,
            );
            ({ meta, body } = await doPost({ conf: token }));
            this.captureTokens(meta, postUrl);
            continue;
          }
          if (e.code === 'app.err.action.version_required') throw e;
          if (e.code === 'app.err.diff.conflict' || e.code === 'app.err.action.conflict') {
            // §7.4: leave the loop with the 409 response so the rebase-retry below can run.
            break;
          }
          throw e;
        }
      }

      if (
        !consentRetried &&
        meta.status === 403 &&
        errorCodeOf(body) === 'app.err.consent.required'
      ) {
        consentRetried = true;
        try {
          this.http.throwIfError(body, meta);
        } catch (e) {
          if (!(e instanceof AppError) || e.code !== 'app.err.consent.required') throw e;
          const grantAction = manifest.actions?.grant_consent ? 'grant_consent' : undefined;
          if (!grantAction) throw e;
          const parsed = parseConsent(manifest);
          const missing = missingConsentPurposes(e.envelope.error.details);
          const purposes = await collectConsent(
            this.onConsent,
            {
              version: parsed?.version,
              purposes: parsed?.purposes ?? missing.map((id) => ({ id, granted: false })),
              missing,
              manifest,
            },
            [...this.policy.deniedConsentPurposes],
          );
          await this.invokeUnlocked(
            manifest,
            grantAction,
            findAction(manifest, grantAction),
            { purposes },
            { skipPolicy: true },
          );
          ({ meta, body } = await doPost({ conf: confirmation }));
          this.captureTokens(meta, postUrl);
          continue;
        }
      }
      break;
    }

    // 409 conflict — re-GET once and rebuild (§7.4)
    if (options.conflictRetry !== false && meta.status === 409) {
      try {
        this.http.throwIfError(body, meta);
      } catch (e) {
        if (
          e instanceof AppError &&
          (e.code === 'app.err.diff.conflict' || e.code === 'app.err.action.conflict')
        ) {
          const fresh = await hydrate(this.hydrateCtx(), manifest.page.url, {
            force: true,
            bypassCache: true,
          });
          const retryBody = buildActionRequest(fresh, actionId, params, {
            name: this.clientName,
            version: this.clientVersion,
          });
          const retryRaw = JSON.stringify(retryBody);
          const retry = await this.http.postAction(
            actionPostUrl(fresh, findAction(fresh, actionId)),
            retryBody,
            {
              pageUrl: fresh.page.url,
              ifMatchVersion: fresh.page.version,
              idempotencyKey,
              confirmation,
              rawBody: retryRaw,
            },
          );
          this.captureTokens(retry.meta, fresh.page.url);
          if (retry.meta.status === 409) {
            throw new AppError('app.err.diff.conflict_persistent', {
              request_id: retry.meta.requestId ?? undefined,
            });
          }
          if (
            retry.meta.status >= 400 &&
            retry.meta.status !== 202 &&
            retry.meta.status !== 303 &&
            retry.meta.status !== 201
          ) {
            this.http.throwIfError(retry.body, retry.meta);
          }
          return this.applyResponse(
            fresh,
            retry.meta,
            retry.body,
            options,
            findAction(fresh, actionId),
          );
        }
        throw e;
      }
    }

    if (meta.status >= 400 && meta.status !== 202) {
      this.http.throwIfError(body, meta);
    }

    const result = await this.applyResponse(manifest, meta, body, options, actionDef);
    if (actionDef.kind === 'delegate') {
      await this.openDelegate(actionDef);
    }
    return result;
  }

  private async openDelegate(actionDef: ActionDef): Promise<void> {
    const url = actionDef.output?.delegates_to;
    if (!url || typeof url !== 'string') return;
    if (!this.onDelegate) {
      throw new AppError('app.err.auth.delegate_unattended', {
        message: 'Agents without onDelegate must not GET IdP URLs',
      });
    }
    const opened = await this.onDelegate({
      url,
      origin: extractOrigin(url),
      sideEffect: actionDef.side_effect ?? 'identity',
    });
    if (!opened.opened) {
      throw new AppError('app.err.auth.delegate_unattended', {
        message: 'Delegate was not opened',
      });
    }
  }

  private async waitForHoldCleared(
    hold: NonNullable<ReturnType<typeof holdFromErrorDetails>>,
    manifest: PageManifest,
  ): Promise<void> {
    const verifyUrl = resolveAppUrl(hold.verify_url, manifest.page.url);
    assertSameOrigin(verifyUrl, manifest.page.url);
    const deadline = Date.now() + holdDeadlineMs(hold);
    const interval = holdPollIntervalMs(hold);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      const page = await hydrate(this.hydrateCtx(), verifyUrl, {
        fromPageUrl: manifest.page.url,
        force: true,
        bypassCache: true,
      });
      const current = holdFromManifest(page);
      const raw = unwrapStateNode(page.state?.human_hold) ?? unwrapStateNode(page.state?.hold);
      const status =
        raw && typeof raw === 'object' && 'status' in raw
          ? String((raw as { status?: unknown }).status)
          : undefined;
      if (status === 'cleared' || !current) return;
    }
    throw new AppError('app.err.hold.expired', {
      message: 'Hold TTL elapsed while waiting',
    });
  }
}

function errorCodeOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('error' in body)) return undefined;
  return (body as { error: { code?: string } }).error?.code;
}

function isAppErrorBody(body: unknown): boolean {
  return typeof errorCodeOf(body) === 'string';
}
