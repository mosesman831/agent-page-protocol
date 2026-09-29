/**
 * Shared action-body parsing for APP servers (SPEC §3.2 / §3.4.1).
 *
 * Every deployment of the middleware needs the same three behaviors and the
 * same error envelopes — bundling them here keeps create-app.ts, the
 * conformance server, and the demo servers from drifting:
 *
 *   1. express.json limited to the APP/JSON content types, with a `verify`
 *      hook that captures the exact raw bytes (`RequestWithRawBody.rawBody`,
 *      required for idempotency fingerprints, §6.7 C10).
 *   2. Strict UTF-8 + BOM rejection: invalid byte sequences and a leading BOM
 *      are recorded on the request and surfaced as `400 app.err.payload.charset`
 *      by `appBodyErrorCheck` (spec: "Bodies MUST be UTF-8", "Leading BOM MUST
 *      be rejected").
 *   3. `appBodyErrorHandler`: body-parser failures (`entity.parse.failed`,
 *      `entity.too.large`, ...) become APP error envelopes instead of Express's
 *      default HTML error page.
 */

import express, {
  type Application,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { randomBytes } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { buildErrorEnvelope } from './errors.js';
import { selectProtocolVersion } from './negotiate.js';
import type { AppProtocolVersion } from './types.js';
import {
  HEADER_APP_ACCEPT_VERSIONS,
  HEADER_APP_REQUEST_ID,
  HEADER_APP_VERSION,
  MEDIA_ERROR,
} from './media-types.js';

export const APP_JSON_MEDIA_TYPES = [
  'application/json',
  'application/vnd.agent-page-action+json',
  'application/*+json',
];

/** Default action-request body limit (SPEC §10.4 hard cap). */
export const APP_JSON_LIMIT = '64kb';

export type { RequestWithRawBody } from './middleware.js';
import type { RequestWithRawBody } from './middleware.js';

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });

function requestId(req: Request): string {
  const h = req.headers[HEADER_APP_REQUEST_ID.toLowerCase()];
  const v = Array.isArray(h) ? h[0] : h;
  return v && v.trim() !== '' ? v.trim() : `req_${randomBytes(8).toString('hex')}`;
}

/**
 * Best-effort version for a pre-middleware error: negotiate from the
 * version headers alone (the body may be unreadable). Falls back to 1.0.
 */
function negotiatedOrDefault(req: Request): AppProtocolVersion {
  const av = req.headers[HEADER_APP_ACCEPT_VERSIONS.toLowerCase()];
  const xv = req.headers[HEADER_APP_VERSION.toLowerCase()];
  const sel = selectProtocolVersion({
    acceptVersions: Array.isArray(av) ? av[0] : av,
    xAppVersion: Array.isArray(xv) ? xv[0] : xv,
  });
  return sel.none ? '1.0' : sel.selected;
}

function sendBodyError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  const envelope = buildErrorEnvelope(code, {
    request_id: requestId(req),
    message,
    app: negotiatedOrDefault(req),
    httpStatus: status,
  });
  res.status(status).type(MEDIA_ERROR).json(envelope);
}

/**
 * Regular middleware placed right after the JSON parser: turns the byte-level
 * violations recorded in `verify` into `app.err.payload.charset` envelopes.
 */
export const appBodyErrorCheck: RequestHandler = (req, res, next) => {
  const be = (req as RequestWithRawBody).bodyError;
  if (be === 'bom') {
    sendBodyError(req, res, 400, 'app.err.payload.charset', 'Body must not start with a BOM');
    return;
  }
  if (be === 'invalid_utf8') {
    sendBodyError(req, res, 400, 'app.err.payload.charset', 'Body is not valid UTF-8');
    return;
  }
  next();
};

/**
 * Express error middleware: maps body-parser `entity.*` failures to APP error
 * envelopes (malformed JSON → invalid_json, oversized → too_large). Other
 * errors are forwarded untouched.
 */
export function appBodyErrorHandler(
  err: { type?: string; status?: number; message?: string },
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    sendBodyError(req, res, 413, 'app.err.payload.too_large', 'Request body exceeds size limit');
    return;
  }
  if (
    typeof err?.type === 'string' &&
    (err.type === 'entity.parse.failed' ||
      err.type === 'entity.verify.failed' ||
      err.type.startsWith('entity.'))
  ) {
    sendBodyError(req, res, 400, 'app.err.payload.invalid_json', 'Body is not valid JSON');
    return;
  }
  next(err);
}

/**
 * Install JSON body parsing for APP action requests on `app`, in order:
 *   express.json (raw capture + encoding check) → charset check → error map.
 */
export function installAppBodyParsing(app: Application, options?: { limit?: string }): void {
  app.use(
    express.json({
      limit: options?.limit ?? APP_JSON_LIMIT,
      type: [...APP_JSON_MEDIA_TYPES],
      verify: (req, _res, buf) => {
        const r = req as RequestWithRawBody;
        r.rawBody = Buffer.from(buf);
        if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
          r.bodyError = 'bom';
          return;
        }
        try {
          utf8Fatal.decode(buf);
        } catch {
          r.bodyError = 'invalid_utf8';
        }
      },
    }),
  );
  app.use(appBodyErrorCheck);
}
