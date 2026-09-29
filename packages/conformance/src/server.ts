/**
 * Ephemeral APP conformance test server backed by @agent-page/server.
 * Serves fixtures for all SPEC §19.3 vectors (TV-01..TV-60).
 */

import { createServer, type Server } from 'node:http';
import express, { type Application, type Request, type Response } from 'express';
import {
  createPageHandler,
  AppError,
  appBodyErrorHandler,
  buildErrorEnvelope,
  installAppBodyParsing,
  MemoryAsyncJobStore,
  bumpVersion,
  buildAsyncPendingManifest,
  buildAsyncFailedSoftError,
  MEDIA_ACTION,
  MEDIA_PAGE,
  MEDIA_ERROR,
  HEADER_APP_NAVIGATE,
  HEADER_APP_VERSION,
  HEADER_APP_CLIENT,
  HEADER_APP_CONFIRMATION,
  HEADER_APP_RESPONSE_MODE,
} from '@agent-page/server';
import { createState, type ConformanceState } from './server/state.js';
import { buildHandlers } from './server/handlers.js';
import { validateManifestState } from './server/validate.js';
import { PAGE_HOST, tvRoute } from './server/fixtures.js';
import { mountV11 } from './server/v11.js';

export type { ConformanceState } from './server/state.js';

export interface ConformanceServer {
  app: Application;
  server: Server;
  baseUrl: string;
  origin: string;
  port: number;
  close: () => Promise<void>;
  state: ConformanceState;
}

function getBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  return m?.[1] ?? null;
}

function sendAppJsonError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId = 'conf',
): void {
  res
    .status(status)
    .type(MEDIA_ERROR)
    .setHeader('X-APP-Response-Mode', 'error')
    .setHeader(HEADER_APP_VERSION, '1.0')
    .json(buildErrorEnvelope(code, { message, httpStatus: status, request_id: requestId }));
}

function normalizePath(pathname: string): string {
  let path = pathname;
  for (const suffix of ['/dest', '/r']) {
    for (const n of [38, 40]) {
      const base = tvRoute(n) + suffix;
      if (path.startsWith(base)) path = base;
    }
  }
  if (path.startsWith(`${tvRoute(8)}/ok`)) return `${tvRoute(8)}/ok`;
  if (path.startsWith(`${tvRoute(6)}/too-many`)) return `${tvRoute(6)}/too-many`;
  return path;
}

export async function startConformanceServer(
  options: { port?: number } = {},
): Promise<ConformanceServer> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(options.port ?? 0, PAGE_HOST, () => resolve());
  });
  const addr = probe.address();
  if (!addr || typeof addr === 'string') {
    probe.close();
    throw new Error('Failed to bind conformance server');
  }
  const port = addr.port;
  await new Promise<void>((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });

  const state = createState(port);
  const asyncJobStore = new MemoryAsyncJobStore();
  const handlers = buildHandlers(state, port);
  const pageOrigin = `http://${PAGE_HOST}:${port}`;

  const app = express();
  app.disable('x-powered-by');
  app.set('strict routing', true);

  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (!['GET', 'POST', 'HEAD', 'OPTIONS'].includes(method)) {
      res.setHeader('Allow', 'GET, HEAD, POST, OPTIONS');
      sendAppJsonError(
        res,
        405,
        'app.err.transport.method_not_allowed',
        `Method ${method} not allowed`,
      );
      return;
    }
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(method) &&
      Number(req.headers['content-length'] ?? 0) > 0
    ) {
      sendAppJsonError(
        res,
        400,
        'app.err.payload.unexpected_body',
        'Body not allowed on safe methods',
      );
      return;
    }
    if (method === 'POST') {
      const conf = req.header(HEADER_APP_CONFIRMATION);
      const client = req.header(HEADER_APP_CLIENT) ?? '';
      if (conf && /^uuid-mode:/i.test(conf) && client.startsWith('agent/')) {
        sendAppJsonError(
          res,
          403,
          'app.err.action.confirmation_invalid',
          'Mode B not allowed for agents',
        );
        return;
      }
    }
    if (req.path === tvRoute(53)) {
      res.setHeader('Access-Control-Allow-Origin', 'https://reader.example');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin');
      if (method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  installAppBodyParsing(app);

  // Trailing-slash redirect must inspect originalUrl — Express non-strict routing would
  // otherwise match both `/path` and `/path/` on a `/path/` route and loop (TV-16/TV-17).
  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      (req.originalUrl === '/.well-known/agent-page/' ||
        req.originalUrl.startsWith('/.well-known/agent-page/?'))
    ) {
      res.redirect(308, '/.well-known/agent-page');
      return;
    }
    next();
  });

  app.get('/.well-known/agent-page-invalid', (_req, res) => {
    sendAppJsonError(
      res,
      502,
      'app.err.discovery.invalid_well_known',
      'Capabilities must be StateNodes',
    );
  });

  mountV11(app, state, port);

  app.post('/auth/refresh', (req, res) => {
    const rt = (req.body as { refresh_token?: string })?.refresh_token;
    if (!rt || !state.refreshMap.has(rt)) {
      sendAppJsonError(res, 401, 'app.err.auth.expired', 'Refresh token invalid');
      return;
    }
    const next = state.refreshMap.get(rt);
    if (next == null) {
      sendAppJsonError(res, 401, 'app.err.auth.expired', 'Refresh failed');
      return;
    }
    state.validTokens.add(next);
    res.status(200).json({ access_token: next, token_type: 'Bearer' });
  });

  app.get('/operations/:jobId', async (req, res) => {
    const job = await asyncJobStore.get(req.params.jobId!);
    if (!job) {
      sendAppJsonError(res, 404, 'app.err.page.not_found', 'Operation not found');
      return;
    }
    const manifest = state.pages.get(job.actionId === 'fail_job' ? tvRoute(51) : tvRoute(50))!;
    if (job.actionId === 'fail_job' && (job.status === 'queued' || job.status === 'running')) {
      // Terminal failed status doc (TV-51): soft async_failed + recoverable retry action.
      job.status = 'failed';
      await asyncJobStore.set(job);
      const failed = buildAsyncPendingManifest({
        page: { ...manifest.page, url: `${pageOrigin}/operations/${job.id}` },
        jobId: job.id,
        statusUrl: job.statusUrl,
        status: 'failed',
        pollIntervalMs: job.pollIntervalMs,
        bumpPageVersion: true,
      });
      failed.error = buildAsyncFailedSoftError({
        jobId: job.id,
        message: 'Async job failed',
        recoverable_actions: ['retry'],
      });
      failed.actions = {
        retry: {
          description: 'Retry the failed operation',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      };
      res.status(200).type(MEDIA_PAGE).setHeader(HEADER_APP_RESPONSE_MODE, 'full').json(failed);
      return;
    }
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'succeeded';
      const next = structuredClone(manifest);
      if (next.state.status) (next.state.status as { value: string }).value = 'done';
      next.page.version = bumpVersion(manifest.page.version);
      job.resultManifest = next;
      state.pages.set(tvRoute(50), next);
      await asyncJobStore.set(job);
    }
    res
      .status(200)
      .type(MEDIA_PAGE)
      .setHeader(HEADER_APP_RESPONSE_MODE, 'full')
      .json(job.resultManifest ?? manifest);
  });

  // TV-42: redirect loop fixture — /a 303s to /b which 303s back to /a.
  for (const [from, to] of [
    [`${tvRoute(42)}/a`, `${tvRoute(42)}/b`],
    [`${tvRoute(42)}/b`, `${tvRoute(42)}/a`],
  ]) {
    app.get(from, (_req, res) => {
      const target = `${pageOrigin}${to}`;
      res
        .status(303)
        .setHeader('Location', target)
        .setHeader(HEADER_APP_NAVIGATE, target)
        .setHeader(HEADER_APP_RESPONSE_MODE, 'redirect')
        .end();
    });
  }

  app.post(tvRoute(39), (_req, res) => {
    res
      .status(303)
      .setHeader('Location', `${pageOrigin}${tvRoute(39)}/a`)
      .setHeader(HEADER_APP_NAVIGATE, `${pageOrigin}${tvRoute(39)}/b`)
      .setHeader(HEADER_APP_RESPONSE_MODE, 'redirect')
      .end();
  });

  app.get('/files/signed-expired', (_req, res) => {
    sendAppJsonError(res, 403, 'app.err.auth.forbidden', 'Signed URL expired');
  });

  // TV-56: the URL a revalidated manifest points at — same host, fresh signature.
  app.get('/files/signed-fresh', (_req, res) => {
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .end(Buffer.from('doc-ok-bytes', 'utf8'));
  });

  app.get(`${tvRoute(2)}/invalid-string-null`, (_req, res) => {
    sendAppJsonError(
      res,
      502,
      'app.err.state.invalid_node',
      'string node must not have null value',
    );
  });

  app.post(`${tvRoute(57)}`, (req, res, next) => {
    const ct = req.header('Content-Type') ?? '';
    if (ct.includes('multipart/form-data')) {
      sendAppJsonError(
        res,
        415,
        'app.err.action.upload_unsupported',
        'file_upload capability not advertised',
      );
      return;
    }
    next();
  });

  const pageHandler = createPageHandler({
    pageOrigin,
    idempotencyStore: state.idempotency,
    confirmationStore: state.confirmation,
    asyncJobStore,
    htmlHandler: (_req, res) => {
      res.status(200).type('text/html').send('<!doctype html><title>APP</title><p>HTML</p>');
    },
    getSessionId: (req) => {
      const cookie = req.headers.cookie ?? '';
      const m = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
      if (m?.[1]) return m[1];
      const bearer = getBearer(req);
      if (bearer) return `bearer:${bearer}`;
      return 'anon';
    },
    getManifest: async ({ url, headers }) => {
      const u = new URL(url);
      const path = normalizePath(u.pathname);
      const manifest = state.pages.get(path);
      if (!manifest) return null;

      if (path === tvRoute(49) || path === '/vectors/auth') {
        const authHeader =
          (typeof headers.authorization === 'string' ? headers.authorization : undefined) ??
          (typeof headers.Authorization === 'string' ? headers.Authorization : undefined);
        const token = authHeader ? /^Bearer\s+(\S+)$/i.exec(authHeader)?.[1] : undefined;
        if (!token || !state.validTokens.has(token)) {
          throw new AppError(token ? 'app.err.auth.expired' : 'app.err.auth.required', {
            message: token ? 'Access token expired' : 'Authentication required',
          });
        }
      }

      const copy = structuredClone(manifest);
      copy.page.url = `${pageOrigin}${path}${u.search}`;
      const gets = (state.pageGets.get(path) ?? 0) + 1;
      state.pageGets.set(path, gets);
      if (path === tvRoute(56) && gets > 1) {
        // Revalidation: the previously-issued signed URL expired; the parent now
        // advertises a fresh same-host URL carrying the sha256 to verify.
        copy.state.doc = {
          type: 'file',
          value: {
            url: `${pageOrigin}/files/signed-fresh`,
            name: 'doc.pdf',
            mime: 'application/pdf',
            sha256: '7f03283822b32a4df90e2827fde376373f74f33b8522238224fb404b97ca0bf8',
          },
          label: 'Doc',
        };
      }
      const err = validateManifestState(copy.state);
      if (err) throw new AppError(err.code, { message: err.message, path: err.path });
      return copy;
    },
    actionHandlers: handlers,
  });

  app.use(pageHandler);
  app.use(appBodyErrorHandler);

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, PAGE_HOST, () => resolve());
  });

  return {
    app,
    server,
    baseUrl: pageOrigin,
    origin: pageOrigin,
    port,
    state,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export { MEDIA_ACTION, MEDIA_PAGE };
