/**
 * Express middleware / page handler for Agent Page Protocol v0.4-Ultimate.
 * Validation order §6.6: size/CT → CSRF → auth → action → authz →
 * idempotency (when key present: lookup/replay before version) →
 * version → confirmation → params → dispatch.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';

import {
  APP_VERSION,
  MEDIA_PAGE,
  MEDIA_DIFF,
  MEDIA_ERROR,
  MEDIA_ACTION,
  HEADER_APP_VERSION,
  HEADER_APP_PAGE_ID,
  HEADER_APP_RESPONSE_MODE,
  HEADER_APP_REQUEST_ID,
  HEADER_APP_IDEMPOTENCY_KEY,
  HEADER_APP_IF_MATCH_VERSION,
  HEADER_APP_CONFIRMATION,
  HEADER_APP_NAVIGATE,
  HEADER_APP_CLIENT,
  HEADER_APP_RESULT_VERSION,
  HEADER_APP_ACCEPT_VERSIONS,
  HEADER_APP_CHALLENGE,
  SUPPORTED_PROTOCOL_VERSIONS,
  parseMediaType,
  type AppResponseMode,
} from './media-types.js';
import { AppError, buildErrorEnvelope, resolveHttpStatus, detailString } from './errors.js';
import { negotiate, parseAcceptHeader, selectProtocolVersion } from './negotiate.js';
import type { AppProtocolVersion } from './types.js';
import { projectManifestToV10, projectErrorEnvelopeToV10 } from './project-v10.js';
import {
  checkCsrf,
  extractOriginFromUrl,
  hasAuthCredentials,
  hasNonCookieAuth,
  readCsrfHeaders,
} from './csrf.js';
import {
  MemoryIdempotencyStore,
  computeIdempotencyFingerprint,
  idempotencyScope,
  lookupIdempotency,
  beginIdempotentRequest,
  storeIdempotentResponse,
  evaluateChallengeContinuation,
  bindChallengeBaseBody,
  challengeIdFromErrorDetails,
  type IdempotencyStore,
  type StoredResponse,
} from './idempotency.js';
import {
  MemoryConfirmationStore,
  issueConfirmationChallenge,
  verifyConfirmation,
  consumeConfirmation,
  type ConfirmationStore,
} from './confirmation.js';
import { buildDiffDocument, shouldPreferFullManifest } from './diff.js';
import { etagMatches, resolveManifestEtag } from './etag.js';
import { checkIfMatchVersion, getPageVersion, bumpVersion } from './version.js';
import {
  buildAsyncPendingManifest,
  MemoryAsyncJobStore,
  createAsyncJob,
  type AsyncJobStore,
} from './async-actions.js';
import { validateStateRoot } from './validate-state.js';
import {
  validateManifestActions,
  validatePageBlock,
  validateNavigation,
  validatePresent,
  validateMeta,
} from './validate-manifest.js';
import { validateParams } from './validate-params.js';
import {
  CHALLENGE_CONTINUATION_PARAMS,
  checkV10FeatureGate,
  parseActionRequestBody,
  checkIdempotencyKeyHeader,
  requiresConfirmation,
} from './validate-action-request.js';
import type {
  ActionHandler,
  ActionResult,
  GetManifest,
  PageManifest,
  DiffDocument,
  ErrorEnvelope,
  ActionRequest,
} from './types.js';

/** Express Request with exact raw body bytes captured by createAppServer. */
export type RequestWithRawBody = Request & {
  rawBody?: Buffer;
  /** Set by the shared body parser when raw bytes violate §3.2 encoding. */
  bodyError?: 'bom' | 'invalid_utf8';
};

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'OPTIONS'] as const;
const ALLOW_HEADER = 'GET, HEAD, POST, OPTIONS';

/** Return q-value for a concrete media type from Accept (0 if absent). */
function qAccepts(accept: string | undefined, mediaType: string): number {
  const ranges = parseAcceptHeader(accept);
  if (!ranges) return 0;
  let best = 0;
  for (const r of ranges) {
    if (r.type === '*/*' || r.type === 'application/*' || r.type === mediaType) {
      if (r.q > best) best = r.q;
    }
  }
  return best;
}

export interface AppServerOptions {
  /** Allowed page origin(s) for CSRF. If omitted, derived from manifest.page.url. */
  pageOrigin?: string;
  /** When true (default), enforce CSRF on POST. */
  csrf?: boolean;
  /** Require auth when using X-APP-Origin without Origin. Default true. */
  requireAuthForAppOrigin?: boolean;
  idempotencyStore?: IdempotencyStore;
  confirmationStore?: ConfirmationStore;
  asyncJobStore?: AsyncJobStore;
  /** Dual-mode: if Accept prefers HTML, call this or next(). */
  htmlHandler?: RequestHandler;
  /** Validate manifests before emit. Default true. */
  validateManifests?: boolean;
  getSessionId?: (req: Request) => string;
  /** Protocol versions this server implements. Default 1.0 and 1.1. */
  supportedVersions?: readonly string[];
  /** Optional auth check hook (step 4). Return error code to reject. */
  authenticate?: (
    req: Request,
  ) => Promise<{ ok: true } | { ok: false; code: string; message?: string; scope?: string }>;
  /** Optional authz check after action existence (step 7). */
  authorize?: (
    req: Request,
    actionId: string,
    actionDef: import('./types.js').ActionDef,
  ) => Promise<{ ok: true } | { ok: false; code: string; message?: string; scope?: string }>;
}

export interface PageHandlerOptions extends AppServerOptions {
  getManifest: GetManifest;
  actionHandlers?: Record<string, ActionHandler>;
}

function header(req: Request, name: string): string | undefined {
  const v = req.header(name);
  return v ?? undefined;
}

function requestId(req: Request): string {
  return header(req, HEADER_APP_REQUEST_ID) ?? `req_${randomBytes(8).toString('hex')}`;
}

function getRawBody(req: Request): Buffer {
  const raw = (req as RequestWithRawBody).rawBody;
  if (raw && Buffer.isBuffer(raw)) return raw;
  // Fallback: re-serialize (less ideal; createAppServer always sets rawBody)
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body !== undefined) return Buffer.from(JSON.stringify(req.body), 'utf8');
  return Buffer.alloc(0);
}

function requestTarget(req: Request): string {
  // path + query (exact request-target)
  return req.originalUrl || req.url || '/';
}

function hasRequestBody(req: Request): boolean {
  const cl = req.headers['content-length'];
  if (cl && Number(cl) > 0) return true;
  if (req.headers['transfer-encoding']) return true;
  const raw = (req as RequestWithRawBody).rawBody;
  if (raw && raw.length > 0) return true;
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (
      typeof req.body === 'object' &&
      !Buffer.isBuffer(req.body) &&
      Object.keys(req.body).length === 0
    ) {
      // express.json may set {} even without body — rely on content-length
      return Boolean(cl && Number(cl) > 0);
    }
    return true;
  }
  return false;
}

type ResponseWithApp = Response & {
  appSelectedVersion?: AppProtocolVersion;
  appHighestOffered?: string | null;
  appIdem?: {
    store: IdempotencyStore;
    scope: string;
    key: string;
    fingerprint: string;
    rawBody: Buffer;
  };
};

function versionOn(res: Response): AppProtocolVersion {
  return (res as ResponseWithApp).appSelectedVersion ?? APP_VERSION;
}

// SPEC-AUTH §6: auth failures carry WWW-Authenticate so clients know the
// scheme, realm, error name, and (for insufficient_scope) the required scope.
function wwwAuthenticateHeader(code: string, scope?: string): string {
  const err = code === 'app.err.auth.insufficient_scope' ? 'insufficient_scope' : 'invalid_token';
  const desc = code === 'app.err.auth.expired' ? ', error_description="expired"' : '';
  return `Bearer realm="app", error="${err}"${desc}${scope ? `, scope="${scope}"` : ''}`;
}

function setAppHeaders(
  res: Response,
  opts: {
    mode: AppResponseMode;
    pageId?: string;
    requestId?: string;
    etag?: string;
    resultVersion?: string;
    varyAccept?: boolean;
    cacheControl?: string;
  },
): void {
  res.setHeader(HEADER_APP_VERSION, versionOn(res));
  res.setHeader(HEADER_APP_RESPONSE_MODE, opts.mode);
  if (opts.pageId) res.setHeader(HEADER_APP_PAGE_ID, opts.pageId);
  if (opts.requestId) res.setHeader(HEADER_APP_REQUEST_ID, opts.requestId);
  if (opts.etag) res.setHeader('ETag', opts.etag);
  if (opts.resultVersion) res.setHeader(HEADER_APP_RESULT_VERSION, opts.resultVersion);
  if (opts.varyAccept !== false) {
    const existing = res.getHeader('Vary');
    if (existing) {
      const s = String(existing);
      if (!/\bAccept\b/i.test(s)) res.setHeader('Vary', `${s}, Accept`);
    } else {
      res.setHeader('Vary', 'Accept');
    }
  }
  if (opts.cacheControl) res.setHeader('Cache-Control', opts.cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendError(
  res: Response,
  envelope: ErrorEnvelope,
  reqId: string,
  pageId?: string,
  extraHeaders?: Record<string, string>,
): void {
  if (!envelope.error.request_id) {
    envelope.error.request_id = reqId;
  }
  const isVersionUnsupported = envelope.error.code === 'app.err.version.unsupported';
  if (!isVersionUnsupported) {
    envelope.app = versionOn(res);
  }
  // Only project when a protocol version was actually negotiated. With no
  // mutual version (e.g. client offered only "9.9"), the 1.0 projection would
  // overwrite the envelope's highest-offered stamp.
  const negotiated =
    (res as ResponseWithApp).appSelectedVersion !== undefined && !isVersionUnsupported;
  if (negotiated && versionOn(res) === '1.0') {
    envelope = projectErrorEnvelopeToV10(envelope);
  }
  const status = resolveHttpStatus(envelope);
  setAppHeaders(res, {
    mode: 'error',
    pageId,
    requestId: reqId,
    cacheControl: 'no-store',
  });
  if (status === 429) {
    const retryMs = envelope.error.retry_after_ms;
    const seconds =
      typeof retryMs === 'number' && retryMs >= 0 ? Math.max(1, Math.ceil(retryMs / 1000)) : 1;
    res.setHeader('Retry-After', String(seconds));
  }
  if (status === 405) {
    res.setHeader('Allow', ALLOW_HEADER);
  }
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  }
  const idem = (res as ResponseWithApp).appIdem;
  if (idem && envelope.error.code === 'app.err.auth.challenge_required') {
    const stored: StoredResponse = {
      status,
      headers: {
        'Content-Type': MEDIA_ERROR,
        [HEADER_APP_RESPONSE_MODE]: 'error',
        [HEADER_APP_VERSION]: versionOn(res),
      },
      body: envelope,
    };
    void storeIdempotentResponse(idem.store, idem.scope, idem.key, idem.fingerprint, stored).then(
      async () => {
        const ch = challengeIdFromErrorDetails(envelope.error.details);
        if (ch) {
          await bindChallengeBaseBody(idem.store, idem.scope, idem.key, idem.rawBody, ch);
        }
      },
    );
  }
  res.status(status).type(MEDIA_ERROR).json(envelope);
}

/**
 * Project + stamp a manifest to the negotiated response version (§2.2/§12).
 * Every APP document a client holds — including idempotency replays — MUST be
 * the projected representation, so callers that store replay bodies use the
 * returned document.
 */
function manifestForResponse(res: Response, manifest: PageManifest): PageManifest {
  let out =
    versionOn(res) === '1.0'
      ? projectManifestToV10(manifest)
      : { ...manifest, app: versionOn(res) };
  const etag = resolveManifestEtag(out);
  if (etag && !out.page.etag) {
    out = { ...out, page: { ...out.page, etag } };
  }
  return out;
}

function sendManifest(
  res: Response,
  manifest: PageManifest,
  reqId: string,
  status = 200,
  mode: AppResponseMode = 'full',
  setResultVersion = false,
): PageManifest {
  const out = manifestForResponse(res, manifest);
  setAppHeaders(res, {
    mode,
    pageId: out.page.id,
    requestId: reqId,
    etag: out.page.etag,
    resultVersion: setResultVersion ? out.page.version : undefined,
    cacheControl: mode === 'async' ? 'no-store' : 'private, no-store',
  });
  res.status(status).type(MEDIA_PAGE).json(out);
  return out;
}

/**
 * Build a diff over the representations the client actually holds (§7/§12):
 * under a 1.0 negotiation both sides are v1.0-projected first so ops never
 * reference 1.1-only paths, and `doc.app` carries the selected version.
 */
function diffForResponse(
  res: Response,
  base: PageManifest,
  next: PageManifest,
  options: Parameters<typeof buildDiffDocument>[2],
): DiffDocument {
  const doc =
    versionOn(res) === '1.0'
      ? buildDiffDocument(projectManifestToV10(base), projectManifestToV10(next), options)
      : buildDiffDocument(base, next, options);
  doc.app = versionOn(res);
  return doc;
}

function sendDiff(res: Response, diffDoc: DiffDocument, reqId: string, pageId: string): void {
  setAppHeaders(res, {
    mode: 'diff',
    pageId,
    requestId: reqId,
    resultVersion: diffDoc.result_version,
    cacheControl: 'private, no-store',
  });
  res.status(200).type(MEDIA_DIFF).json(diffDoc);
}

function absoluteUrl(req: Request): string {
  const host = req.get('host') ?? 'localhost';
  const proto = (req.get('x-forwarded-proto') ?? req.protocol ?? 'http').split(',')[0]!.trim();
  return `${proto}://${host}${req.originalUrl}`;
}

/**
 * Core page handler: GET/HEAD/OPTIONS manifests + POST actions.
 */
export function createPageHandler(options: PageHandlerOptions): RequestHandler {
  const idemStore = options.idempotencyStore ?? new MemoryIdempotencyStore();
  const confStore = options.confirmationStore ?? new MemoryConfirmationStore();
  const asyncStore = options.asyncJobStore ?? new MemoryAsyncJobStore();
  const validateManifests = options.validateManifests !== false;
  const csrfEnabled = options.csrf !== false;
  const requireAuthForAppOrigin = options.requireAuthForAppOrigin !== false;
  const supportedVersions = options.supportedVersions ?? SUPPORTED_PROTOCOL_VERSIONS;
  const getSessionId =
    options.getSessionId ??
    ((req: Request) => {
      const cookie = req.headers.cookie ?? '';
      const m = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
      return m?.[1] ?? 'anon';
    });

  return async (req: Request, res: Response, next: NextFunction) => {
    const reqId = requestId(req);
    try {
      const method = req.method.toUpperCase();
      const accept = header(req, 'Accept');
      const acceptVersions = header(req, HEADER_APP_ACCEPT_VERSIONS);
      const xAppVersion = header(req, HEADER_APP_VERSION);
      const versionPick = selectProtocolVersion({
        acceptVersions,
        xAppVersion,
        supported: supportedVersions,
      });
      if (!versionPick.none) {
        (res as ResponseWithApp).appSelectedVersion = versionPick.selected;
      }
      (res as ResponseWithApp).appHighestOffered = versionPick.highestOffered;

      // --- Method matrix §3.6 ---
      if (!(ALLOWED_METHODS as readonly string[]).includes(method)) {
        sendError(
          res,
          buildErrorEnvelope('app.err.transport.method_not_allowed', {
            message: `Method ${method} not allowed`,
            request_id: reqId,
          }),
          reqId,
        );
        return;
      }

      if (method === 'OPTIONS') {
        if (hasRequestBody(req)) {
          sendError(
            res,
            buildErrorEnvelope('app.err.payload.unexpected_body', { request_id: reqId }),
            reqId,
          );
          return;
        }
        res.setHeader('Allow', ALLOW_HEADER);
        res.setHeader(HEADER_APP_VERSION, APP_VERSION);
        res.status(204).end();
        return;
      }

      if ((method === 'GET' || method === 'HEAD') && hasRequestBody(req)) {
        sendError(
          res,
          buildErrorEnvelope('app.err.payload.unexpected_body', { request_id: reqId }),
          reqId,
        );
        return;
      }

      if (method === 'GET' || method === 'HEAD') {
        const neg = negotiate(accept, {
          method: 'GET',
          acceptVersions,
          xAppVersion,
          supportedVersions,
        });
        if (neg.selectedVersion) {
          (res as ResponseWithApp).appSelectedVersion = neg.selectedVersion;
        }
        if (neg.badAccept) {
          sendError(
            res,
            buildErrorEnvelope('app.err.negotiate.bad_accept', { request_id: reqId }),
            reqId,
          );
          return;
        }
        if (neg.versionMismatch) {
          const offered = (neg.highestOffered ?? versionPick.highestOffered) as
            AppProtocolVersion | undefined;
          sendError(
            res,
            buildErrorEnvelope('app.err.version.version_mismatch', {
              request_id: reqId,
              app:
                offered && /^\d+\.\d+$/.test(offered)
                  ? (offered as AppProtocolVersion)
                  : APP_VERSION,
            }),
            reqId,
          );
          return;
        }
        if (neg.versionUnsupported) {
          // K3 MF-2: version.unsupported envelope uses the HIGHEST version the client offered.
          const highest = neg.highestOffered ?? versionPick.highestOffered ?? '1.0';
          const envelopeApp = /^\d+\.\d+$/.test(highest)
            ? (highest as AppProtocolVersion)
            : APP_VERSION;
          sendError(
            res,
            buildErrorEnvelope('app.err.version.unsupported', {
              request_id: reqId,
              app: envelopeApp,
              httpStatus: 406,
              details: {
                supported: {
                  type: 'array',
                  value: supportedVersions.map((v) => ({ type: 'string' as const, value: v })),
                },
              },
            }),
            reqId,
          );
          return;
        }
        if (!neg.acceptable) {
          sendError(
            res,
            buildErrorEnvelope('app.err.negotiate.not_acceptable', { request_id: reqId }),
            reqId,
          );
          return;
        }
        if (neg.selected === 'text/html') {
          // Dual-mode (A): htmlHandler serves transitional HTML.
          // Agent-native (B, §4.5): no HTML representation → 406.
          if (options.htmlHandler) {
            options.htmlHandler(req, res, next);
            return;
          }
          sendError(
            res,
            buildErrorEnvelope('app.err.negotiate.not_acceptable', {
              message: 'Agent-native page has no HTML representation',
              request_id: reqId,
            }),
            reqId,
          );
          return;
        }

        let manifest = await options.getManifest({
          url: absoluteUrl(req),
          headers: req.headers as Record<string, string | string[] | undefined>,
          query: req.query as Record<string, unknown>,
        });

        if (!manifest) {
          sendError(
            res,
            buildErrorEnvelope('app.err.page.not_found', { request_id: reqId }),
            reqId,
          );
          return;
        }

        if (manifest.app !== versionOn(res)) {
          manifest = { ...manifest, app: versionOn(res) };
        }

        if (validateManifests) {
          const stateErr =
            validatePageBlock(manifest.page) ??
            validateStateRoot(manifest.state) ??
            validateManifestActions(manifest) ??
            validateNavigation(manifest.navigation) ??
            validatePresent(manifest.present) ??
            validateMeta(manifest.meta);
          if (stateErr) {
            sendError(
              res,
              buildErrorEnvelope(stateErr.code, {
                message: stateErr.message,
                path: stateErr.path,
                request_id: reqId,
              }),
              reqId,
              manifest.page.id,
            );
            return;
          }
        }

        const etag = resolveManifestEtag(manifest);
        if (etag && etagMatches(etag, header(req, 'If-None-Match'))) {
          setAppHeaders(res, {
            mode: 'full',
            pageId: manifest.page.id,
            requestId: reqId,
            etag,
          });
          res.status(304).end();
          return;
        }

        if (method === 'HEAD') {
          setAppHeaders(res, {
            mode: 'full',
            pageId: manifest.page.id,
            requestId: reqId,
            etag,
          });
          res.status(200).type(MEDIA_PAGE).end();
          return;
        }

        sendManifest(res, manifest, reqId);
        return;
      }

      // --- Action POST — validation order §6.6 ---
      const wantsDiffHint = (() => {
        const neg = negotiate(accept, {
          method: 'POST',
          wantsDiff: true,
          canProduceDiff: true,
          acceptVersions,
          xAppVersion,
          supportedVersions,
        });
        return neg.preferDiff || neg.selected === MEDIA_DIFF;
      })();

      const neg = negotiate(accept, {
        method: 'POST',
        wantsDiff: wantsDiffHint,
        canProduceDiff: true,
        acceptVersions,
        xAppVersion,
        supportedVersions,
      });
      if (neg.selectedVersion) {
        (res as ResponseWithApp).appSelectedVersion = neg.selectedVersion;
      }
      if (neg.badAccept) {
        sendError(
          res,
          buildErrorEnvelope('app.err.negotiate.bad_accept', { request_id: reqId }),
          reqId,
        );
        return;
      }
      if (neg.versionMismatch) {
        const offered = (neg.highestOffered ?? versionPick.highestOffered) as
          AppProtocolVersion | undefined;
        sendError(
          res,
          buildErrorEnvelope('app.err.version.version_mismatch', {
            request_id: reqId,
            app:
              offered && /^\d+\.\d+$/.test(offered) ? (offered as AppProtocolVersion) : APP_VERSION,
          }),
          reqId,
        );
        return;
      }
      if (neg.versionUnsupported) {
        const highest = neg.highestOffered ?? versionPick.highestOffered ?? '1.0';
        const envelopeApp = /^\d+\.\d+$/.test(highest)
          ? (highest as AppProtocolVersion)
          : APP_VERSION;
        sendError(
          res,
          buildErrorEnvelope('app.err.version.unsupported', {
            request_id: reqId,
            app: envelopeApp,
            httpStatus: 406,
            details: {
              supported: {
                type: 'array',
                value: supportedVersions.map((v) => ({ type: 'string' as const, value: v })),
              },
            },
          }),
          reqId,
        );
        return;
      }
      if (!neg.acceptable || neg.selected === 'text/html') {
        sendError(
          res,
          buildErrorEnvelope('app.err.negotiate.not_acceptable', { request_id: reqId }),
          reqId,
        );
        return;
      }

      // Step 2: Content-Type (size handled by express.json limit)
      const ct = parseMediaType(header(req, 'Content-Type'));
      if (ct !== MEDIA_ACTION) {
        sendError(
          res,
          buildErrorEnvelope('app.err.negotiate.unsupported_media_type', {
            message: `Content-Type must be ${MEDIA_ACTION}`,
            request_id: reqId,
          }),
          reqId,
        );
        return;
      }

      const current = await options.getManifest({
        url: absoluteUrl(req),
        headers: req.headers as Record<string, string | string[] | undefined>,
        query: req.query as Record<string, unknown>,
      });
      if (!current) {
        sendError(res, buildErrorEnvelope('app.err.page.not_found', { request_id: reqId }), reqId);
        return;
      }

      const pageOrigin =
        options.pageOrigin ??
        extractOriginFromUrl(current.page.url) ??
        extractOriginFromUrl(absoluteUrl(req));
      if (!pageOrigin) {
        sendError(
          res,
          buildErrorEnvelope('app.err.internal.server', {
            message: 'Unable to determine page origin',
            request_id: reqId,
          }),
          reqId,
          current.page.id,
        );
        return;
      }

      // Step 3: CSRF (§10.2: X-APP-Origin path needs non-cookie auth)
      if (csrfEnabled) {
        const { origin, appOrigin } = readCsrfHeaders(
          req.headers as Record<string, string | string[] | undefined>,
        );
        const nonCookieAuth = hasNonCookieAuth(
          req.headers as Record<string, string | string[] | undefined>,
        );
        const csrf = checkCsrf({
          method: 'POST',
          origin,
          appOrigin,
          pageOrigin,
          hasValidAuth: requireAuthForAppOrigin ? nonCookieAuth : true,
        });
        if (!csrf.ok) {
          sendError(
            res,
            buildErrorEnvelope(csrf.code ?? 'app.err.security.csrf', {
              message: csrf.message,
              request_id: reqId,
            }),
            reqId,
            current.page.id,
          );
          return;
        }
      }

      // Step 4: Authentication
      if (options.authenticate) {
        const authResult = await options.authenticate(req);
        if (!authResult.ok) {
          sendError(
            res,
            buildErrorEnvelope(authResult.code, {
              message: authResult.message,
              request_id: reqId,
            }),
            reqId,
            current.page.id,
            { 'WWW-Authenticate': wwwAuthenticateHeader(authResult.code, authResult.scope) },
          );
          return;
        }
      }

      // Parse body
      let body = req.body;
      if (body === undefined || body === null || body === '') {
        sendError(
          res,
          buildErrorEnvelope('app.err.payload.invalid_json', {
            message: 'Empty POST body',
            request_id: reqId,
          }),
          reqId,
          current.page.id,
        );
        return;
      }
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          sendError(
            res,
            buildErrorEnvelope('app.err.payload.invalid_json', { request_id: reqId }),
            reqId,
            current.page.id,
          );
          return;
        }
      }

      const rawBody = getRawBody(req);
      const parsed = parseActionRequestBody(body);
      if (!parsed.ok) {
        sendError(
          res,
          buildErrorEnvelope(parsed.error.code, {
            message: parsed.error.message,
            path: parsed.error.path,
            request_id: reqId,
          }),
          reqId,
          current.page.id,
        );
        return;
      }

      const { actionId, raw } = parsed;
      const actionDef = current.actions?.[actionId];

      // Need actionDef early for requires_etag_match (step 5) — but action existence is step 6.
      // Spec order: version (5) then action existence (6). Version check uses ActionDef.requires_etag_match.
      // If action unknown, we still can check version only when we know the action.
      // Practical order aligning with spec intent: resolve action existence for version rules,
      // but emit action.not_found before proceeding further. Spec lists version before action
      // existence; requires_etag_match is per-ActionDef. We resolve action first only to read
      // the flag, then apply version, then confirm action exists for not_found.

      // Step 6 first for unknown action (cannot apply ActionDef version rules otherwise)
      if (!actionDef) {
        sendError(
          res,
          buildErrorEnvelope('app.err.action.not_found', {
            message: `Unknown action: ${actionId}`,
            path: '/action',
            request_id: reqId,
          }),
          reqId,
          current.page.id,
        );
        return;
      }

      const sessionId = getSessionId(req);
      const serverVersion = getPageVersion(current);
      const idemKey = header(req, HEADER_APP_IDEMPOTENCY_KEY) ?? null;

      // Idempotency key format/presence check (part of request validation; before dispatch)
      const idemHeaderErr = checkIdempotencyKeyHeader(actionDef, idemKey);
      if (idemHeaderErr) {
        sendError(
          res,
          buildErrorEnvelope(idemHeaderErr.code, {
            message: idemHeaderErr.message,
            path: idemHeaderErr.path,
            request_id: reqId,
          }),
          reqId,
          current.page.id,
        );
        return;
      }

      // Step 7: Authorization (before idempotency so unauthorized callers cannot probe keys)
      if (options.authorize) {
        const az = await options.authorize(req, actionId, actionDef);
        if (!az.ok) {
          sendError(
            res,
            buildErrorEnvelope(az.code, {
              message: az.message,
              request_id: reqId,
            }),
            reqId,
            current.page.id,
            { 'WWW-Authenticate': wwwAuthenticateHeader(az.code, az.scope) },
          );
          return;
        }
      } else if (actionDef.auth && actionDef.auth !== 'none') {
        const authPresent = hasAuthCredentials(
          req.headers as Record<string, string | string[] | undefined>,
        );
        if (!authPresent) {
          sendError(
            res,
            buildErrorEnvelope('app.err.auth.required', { request_id: reqId }),
            reqId,
            current.page.id,
            { 'WWW-Authenticate': wwwAuthenticateHeader('app.err.auth.required') },
          );
          return;
        }
      }

      // When X-APP-Idempotency-Key is present: lookup BEFORE version/confirm/params/dispatch.
      // Replay must return the stored response even if page.version has since bumped (TV-27).
      // Defer beginIdempotentRequest until after confirmation so a 428 challenge does not
      // leave the key in_flight and block the confirmed retry.
      const fingerprint = computeIdempotencyFingerprint(
        method,
        requestTarget(req),
        actionId,
        rawBody,
      );
      const scope = idempotencyScope(sessionId, current.page.id);
      const selectedVersion = versionOn(res);
      if (idemKey) {
        (res as ResponseWithApp).appIdem = {
          store: idemStore,
          scope,
          key: idemKey,
          fingerprint,
          rawBody,
        };
      }
      let challengeContinuation = false;
      if (idemKey) {
        const look = await lookupIdempotency(idemStore, scope, idemKey, fingerprint);
        if (look.type === 'conflict' && look.record) {
          const challengeHeader = header(req, HEADER_APP_CHALLENGE);
          const cont = evaluateChallengeContinuation({
            record: look.record,
            selectedVersion,
            challengeHeader,
            newRawBody: rawBody,
          });
          if (cont.type === 'invalid') {
            sendError(
              res,
              buildErrorEnvelope('app.err.auth.challenge_invalid', {
                request_id: reqId,
                app: selectedVersion,
              }),
              reqId,
              current.page.id,
            );
            return;
          }
          if (cont.type === 'not_continuation') {
            sendError(
              res,
              buildErrorEnvelope('app.err.action.idempotency_conflict', { request_id: reqId }),
              reqId,
              current.page.id,
            );
            return;
          }
          // cont.type === 'continue': §18.2 exception — treat as completion of K, not conflict.
          challengeContinuation = true;
        } else if (look.type === 'conflict') {
          sendError(
            res,
            buildErrorEnvelope('app.err.action.idempotency_conflict', { request_id: reqId }),
            reqId,
            current.page.id,
          );
          return;
        }
        if (look.type === 'in_flight') {
          sendError(
            res,
            buildErrorEnvelope('app.err.action.conflict', {
              message: 'Idempotent request still in flight; retry with the same key',
              retryable: true,
              request_id: reqId,
            }),
            reqId,
            current.page.id,
          );
          return;
        }
        if (look.type === 'replay' && look.record?.response) {
          const stored = look.record.response;
          for (const [k, v] of Object.entries(stored.headers)) {
            res.setHeader(k, v);
          }
          res.status(stored.status);
          if (stored.body === null || stored.body === undefined || stored.body === '') {
            res.end();
          } else {
            res.json(stored.body);
          }
          return;
        }
      }

      // Step 5: Version (from ActionDef.requires_etag_match — C16, NOT manifest.meta)
      // Runs after idempotency replay so stale If-Match on replay does not 409.
      const ifMatch = header(req, HEADER_APP_IF_MATCH_VERSION);
      const requiresMatch = actionDef.requires_etag_match === true;
      const ver = checkIfMatchVersion(serverVersion, ifMatch, { requiresMatch });
      if (!ver.ok) {
        if (ver.reason === 'missing') {
          sendError(
            res,
            buildErrorEnvelope('app.err.action.version_required', {
              message: 'X-APP-If-Match-Version is required for this action',
              request_id: reqId,
            }),
            reqId,
            current.page.id,
          );
          return;
        }
        sendError(
          res,
          buildErrorEnvelope('app.err.diff.conflict', {
            message: `X-APP-If-Match-Version mismatch: client=${ver.clientVersion ?? '(missing)'} server=${ver.serverVersion}`,
            request_id: reqId,
            details: {
              client_version: detailString(ver.clientVersion ?? '', 'client'),
              server_version: detailString(ver.serverVersion, 'server'),
            },
          }),
          reqId,
          current.page.id,
        );
        return;
      }

      // Step 8: Confirmation (binds to exact raw body bytes — C10)
      if (requiresConfirmation(actionDef)) {
        const confToken = header(req, HEADER_APP_CONFIRMATION);
        const clientHeader = header(req, HEADER_APP_CLIENT);
        const verified = await verifyConfirmation(confStore, {
          token: confToken,
          actionId,
          rawBody,
          pageVersion: serverVersion,
          sessionId,
          clientHeader,
        });
        if (!verified.ok) {
          if (verified.reason === 'missing') {
            const challenge = await issueConfirmationChallenge(confStore, {
              actionId,
              rawBody,
              pageVersion: serverVersion,
              sessionId,
            });
            const serverTime = new Date().toISOString();
            sendError(
              res,
              buildErrorEnvelope('app.err.action.confirmation_required', {
                request_id: reqId,
                details: {
                  confirmation_challenge: {
                    type: 'string',
                    value: challenge.token,
                    label: 'Confirmation challenge',
                  },
                },
                meta: { server_time: serverTime },
              }),
              reqId,
              current.page.id,
            );
            return;
          }
          sendError(
            res,
            buildErrorEnvelope('app.err.action.confirmation_invalid', {
              message: `Confirmation invalid: ${verified.reason}`,
              request_id: reqId,
            }),
            reqId,
            current.page.id,
          );
          return;
        }
        await consumeConfirmation(confStore, confToken!);
      }

      // Mark in-flight only after version + confirmation succeed (miss path).
      // A challenge continuation must not re-begin: that would wipe the
      // stored challengeId/base body bound to the original request.
      if (idemKey && !challengeContinuation) {
        await beginIdempotentRequest(idemStore, scope, idemKey, fingerprint);
      }

      // Step 10: Parameter validation (ActionDef.param_mode — C16)
      const paramMode = actionDef.param_mode ?? 'strict';
      const rawParams = (raw.params as Record<string, unknown> | undefined) ?? {};
      // Version gate (SPEC §0.x): under a 1.0 selection reject requests that
      // use 1.1 constructs — challenge continuation, bulk, 1.1-only param
      // types present in params, options_source on any declared input.
      if (versionOn(res) === '1.0') {
        const extraChallenge = Object.keys(rawParams).filter(
          (k) =>
            CHALLENGE_CONTINUATION_PARAMS.includes(k) && !(actionDef.input && k in actionDef.input),
        );
        const gate = checkV10FeatureGate({
          actionDef,
          paramsRaw: rawParams,
          extraChallenge,
          challengeContinuation,
        });
        if (!gate.ok) {
          sendError(
            res,
            buildErrorEnvelope(gate.error.code, {
              message: gate.error.message,
              path: gate.error.path,
              details: gate.error.details,
              request_id: reqId,
            }),
            reqId,
            current.page.id,
          );
          return;
        }
      }
      const paramResult = validateParams(actionDef.input, rawParams, { mode: paramMode });
      if (!paramResult.ok) {
        sendError(
          res,
          buildErrorEnvelope(paramResult.error.code, {
            message: paramResult.error.message,
            path: paramResult.error.path,
            details: paramResult.error.details,
            request_id: reqId,
          }),
          reqId,
          current.page.id,
        );
        return;
      }

      const params = paramResult.params;
      const actionRequest: ActionRequest = {
        app: APP_VERSION,
        action: actionId,
        params,
      };
      if (raw.client && typeof raw.client === 'object' && !Array.isArray(raw.client)) {
        actionRequest.client = raw.client as ActionRequest['client'];
      }
      if (raw.context && typeof raw.context === 'object' && !Array.isArray(raw.context)) {
        actionRequest.context = raw.context as ActionRequest['context'];
      }

      // Step 11: Dispatch
      const handler = options.actionHandlers?.[actionId];
      if (!handler) {
        sendError(
          res,
          buildErrorEnvelope('app.err.action.unavailable', {
            message: `No handler registered for action: ${actionId}`,
            request_id: reqId,
          }),
          reqId,
          current.page.id,
        );
        return;
      }

      const result: ActionResult = await handler({
        actionId,
        actionDef,
        params,
        request: actionRequest,
        manifest: current,
        headers: req.headers as Record<string, string | string[] | undefined>,
        sessionId,
        requestId: reqId,
        rawBody,
      });

      const storeReplay = async (stored: StoredResponse) => {
        if (idemKey) {
          await storeIdempotentResponse(idemStore, scope, idemKey, fingerprint, stored);
        }
      };

      // --- Form D: Async 202 ---
      if (result.type === 'async') {
        const statusUrl =
          result.statusUrl ??
          `${extractOriginFromUrl(current.page.url) ?? pageOrigin}/operations/${result.jobId}`;
        await createAsyncJob(asyncStore, {
          id: result.jobId,
          actionId,
          pageId: current.page.id,
          statusUrl,
          pollIntervalMs: result.pollIntervalMs,
          status: result.status ?? 'queued',
          progress: result.progress,
        });
        const page = result.page ?? {
          ...current.page,
          version: result.version ?? bumpVersion(current.page.version),
        };
        const asyncManifest = buildAsyncPendingManifest({
          page,
          jobId: result.jobId,
          statusUrl,
          status: result.status ?? 'queued',
          progress: result.progress,
          pollIntervalMs: result.pollIntervalMs,
          requestId: reqId,
          bumpPageVersion: false,
        });
        const sentAsync = sendManifest(res, asyncManifest, reqId, 202, 'async', true);
        await storeReplay({
          status: 202,
          headers: {
            'Content-Type': MEDIA_PAGE,
            [HEADER_APP_RESPONSE_MODE]: 'async',
            [HEADER_APP_VERSION]: versionOn(res),
            [HEADER_APP_PAGE_ID]: sentAsync.page.id,
            [HEADER_APP_RESULT_VERSION]: sentAsync.page.version,
          },
          body: sentAsync,
        });
        return;
      }

      // --- Form C: Navigate 303 (empty body) / 201 ---
      if (result.type === 'navigate') {
        const status = result.status ?? 303;
        setAppHeaders(res, {
          mode: 'redirect',
          pageId: current.page.id,
          requestId: reqId,
          cacheControl: 'no-store',
        });
        res.setHeader('Location', result.url);
        res.setHeader(HEADER_APP_NAVIGATE, result.url);

        if (status === 201 && result.manifest) {
          setAppHeaders(res, {
            mode: 'redirect',
            pageId: result.manifest.page.id,
            requestId: reqId,
            resultVersion: result.manifest.page.version,
            cacheControl: 'no-store',
          });
          res.setHeader('Location', result.url);
          res.setHeader(HEADER_APP_NAVIGATE, result.url);
          const sent201 = sendManifest(res, result.manifest, reqId, 201, 'redirect', true);
          await storeReplay({
            status: 201,
            headers: {
              'Content-Type': MEDIA_PAGE,
              Location: result.url,
              [HEADER_APP_NAVIGATE]: result.url,
              [HEADER_APP_RESPONSE_MODE]: 'redirect',
              [HEADER_APP_VERSION]: versionOn(res),
              [HEADER_APP_PAGE_ID]: sent201.page.id,
              [HEADER_APP_RESULT_VERSION]: sent201.page.version,
            },
            body: sent201,
          });
          return;
        }

        // 303: body SHOULD be empty (C4)
        await storeReplay({
          status: 303,
          headers: {
            Location: result.url,
            [HEADER_APP_NAVIGATE]: result.url,
            [HEADER_APP_RESPONSE_MODE]: 'redirect',
            [HEADER_APP_VERSION]: versionOn(res),
            [HEADER_APP_PAGE_ID]: current.page.id,
          },
          body: '',
        });
        res.status(303).end();
        return;
      }

      if (result.type === 'full') {
        if (validateManifests) {
          const stateErr =
            validatePageBlock(result.manifest.page) ??
            validateStateRoot(result.manifest.state) ??
            validateManifestActions(result.manifest) ??
            validateNavigation(result.manifest.navigation) ??
            validatePresent(result.manifest.present) ??
            validateMeta(result.manifest.meta);
          if (stateErr) {
            sendError(
              res,
              buildErrorEnvelope(stateErr.code, {
                message: stateErr.message,
                path: stateErr.path,
                request_id: reqId,
              }),
              reqId,
              current.page.id,
            );
            return;
          }
        }
        const sentFull = sendManifest(res, result.manifest, reqId, 200, 'full', true);
        await storeReplay({
          status: 200,
          headers: {
            'Content-Type': MEDIA_PAGE,
            [HEADER_APP_RESPONSE_MODE]: 'full',
            [HEADER_APP_VERSION]: versionOn(res),
            [HEADER_APP_PAGE_ID]: sentFull.page.id,
            [HEADER_APP_RESULT_VERSION]: sentFull.page.version,
          },
          body: sentFull,
        });
        return;
      }

      // diff
      if (validateManifests) {
        const stateErr =
          validatePageBlock(result.nextManifest.page) ??
          validateStateRoot(result.nextManifest.state) ??
          validateManifestActions(result.nextManifest) ??
          validateNavigation(result.nextManifest.navigation) ??
          validatePresent(result.nextManifest.present) ??
          validateMeta(result.nextManifest.meta);
        if (stateErr) {
          sendError(
            res,
            buildErrorEnvelope(stateErr.code, {
              message: stateErr.message,
              path: stateErr.path,
              request_id: reqId,
            }),
            reqId,
            current.page.id,
          );
          return;
        }
      }

      const acceptDiff = qAccepts(accept, MEDIA_DIFF) > 0;
      const acceptFull = qAccepts(accept, MEDIA_PAGE) > 0;
      const preferDiffResponse = actionDef.output?.state_diff === true && acceptDiff;

      if (preferDiffResponse) {
        const diffDoc = diffForResponse(res, current, result.nextManifest, {
          requestId: reqId,
        });
        if (shouldPreferFullManifest(result.nextManifest, diffDoc) && acceptFull) {
          const sentFallback = sendManifest(res, result.nextManifest, reqId, 200, 'full', true);
          await storeReplay({
            status: 200,
            headers: {
              'Content-Type': MEDIA_PAGE,
              [HEADER_APP_RESPONSE_MODE]: 'full',
              [HEADER_APP_VERSION]: versionOn(res),
              [HEADER_APP_PAGE_ID]: sentFallback.page.id,
              [HEADER_APP_RESULT_VERSION]: sentFallback.page.version,
            },
            body: sentFallback,
          });
          return;
        }
        sendDiff(res, diffDoc, reqId, current.page.id);
        await storeReplay({
          status: 200,
          headers: {
            'Content-Type': MEDIA_DIFF,
            [HEADER_APP_RESPONSE_MODE]: 'diff',
            [HEADER_APP_VERSION]: versionOn(res),
            [HEADER_APP_PAGE_ID]: current.page.id,
            [HEADER_APP_RESULT_VERSION]: diffDoc.result_version,
          },
          body: diffDoc,
        });
        return;
      }

      if (!acceptFull && acceptDiff) {
        const diffDoc = diffForResponse(res, current, result.nextManifest, {
          requestId: reqId,
        });
        sendDiff(res, diffDoc, reqId, current.page.id);
        await storeReplay({
          status: 200,
          headers: {
            'Content-Type': MEDIA_DIFF,
            [HEADER_APP_RESPONSE_MODE]: 'diff',
            [HEADER_APP_VERSION]: versionOn(res),
            [HEADER_APP_PAGE_ID]: current.page.id,
            [HEADER_APP_RESULT_VERSION]: diffDoc.result_version,
          },
          body: diffDoc,
        });
        return;
      }

      const sentNext = sendManifest(res, result.nextManifest, reqId, 200, 'full', true);
      await storeReplay({
        status: 200,
        headers: {
          'Content-Type': MEDIA_PAGE,
          [HEADER_APP_RESPONSE_MODE]: 'full',
          [HEADER_APP_VERSION]: versionOn(res),
          [HEADER_APP_PAGE_ID]: sentNext.page.id,
          [HEADER_APP_RESULT_VERSION]: sentNext.page.version,
        },
        body: sentNext,
      });
    } catch (err) {
      if (err instanceof AppError) {
        if (
          err.envelope.app !== versionOn(res) &&
          err.envelope.error.code !== 'app.err.version.unsupported'
        ) {
          err.envelope.app = versionOn(res);
        }
        sendError(res, err.envelope, reqId);
        return;
      }
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendError(
        res,
        buildErrorEnvelope('app.err.internal.server', {
          message,
          request_id: reqId,
        }),
        reqId,
      );
    }
  };
}

/**
 * Lightweight middleware that only sets APP negotiation awareness / error helper.
 * Prefer createPageHandler for full behavior.
 */
export function appMiddleware(options: AppServerOptions = {}): RequestHandler {
  void options;
  return (req: Request, res: Response, next: NextFunction) => {
    type AppRes = Response & {
      appError: (
        code: string,
        opts?: {
          message?: string;
          path?: string;
          request_id?: string;
          pageId?: string;
          details?: ErrorEnvelope['error']['details'];
        },
      ) => void;
    };
    (res as AppRes).appError = (code: string, opts?: Parameters<typeof sendAppError>[2]) =>
      sendAppError(res, code, opts);
    (req as Request & { appRequestId: string }).appRequestId = requestId(req);
    next();
  };
}

export function sendAppError(
  res: Response,
  code: string,
  opts?: {
    message?: string;
    path?: string;
    request_id?: string;
    pageId?: string;
    details?: ErrorEnvelope['error']['details'];
  },
): void {
  const envelope = buildErrorEnvelope(code, opts);
  sendError(
    res,
    envelope,
    opts?.request_id ?? `req_${randomBytes(4).toString('hex')}`,
    opts?.pageId,
  );
}

/** Fastify-style plugin factory (optional adapter). */
export function createFastifyPlugin(options: PageHandlerOptions) {
  const handler = createPageHandler(options);
  return async function appFastifyPlugin(
    instance: {
      all: (path: string, h: (req: unknown, reply: unknown) => void) => void;
    },
    opts: { prefix?: string } = {},
  ): Promise<void> {
    const prefix = opts.prefix ?? '/*';
    void handler;
    void instance;
    void prefix;
    throw new Error(
      'Use createPageHandler with @fastify/middie or Express. Direct Fastify adapter requires middie.',
    );
  };
}

export {
  MEDIA_PAGE,
  MEDIA_DIFF,
  MEDIA_ERROR,
  MEDIA_ACTION,
  HEADER_APP_CLIENT,
  HEADER_APP_RESULT_VERSION,
};
