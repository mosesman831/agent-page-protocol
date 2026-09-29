/**
 * Helper to create an Express app with APP middleware.
 * Captures exact raw body bytes for confirmation / idempotency fingerprints (C10 / §6.7).
 */

import express, { type Application, type RequestHandler } from 'express';
import {
  createPageHandler,
  appMiddleware,
  type AppServerOptions,
  type PageHandlerOptions,
  type RequestWithRawBody,
} from './middleware.js';
import { appBodyErrorHandler, installAppBodyParsing } from './body-parse.js';
import type { ActionHandler, GetManifest } from './types.js';

export type { RequestWithRawBody };

export interface CreateAppServerOptions extends AppServerOptions {
  getManifest: GetManifest;
  actionHandlers?: Record<string, ActionHandler>;
  /** Mount path for the page handler. Default `/`. */
  path?: string;
  /** JSON body limit for action requests (SPEC hard limit 64 KiB). */
  jsonLimit?: string;
  /** Extra middleware before APP handler. */
  before?: RequestHandler[];
}

/**
 * Create a ready-to-listen Express application with APP page/action handling.
 */
export function createAppServer(options: CreateAppServerOptions): Application {
  const app = express();

  app.disable('x-powered-by');
  installAppBodyParsing(app, { limit: options.jsonLimit });

  app.use(appMiddleware(options));

  for (const mw of options.before ?? []) {
    app.use(mw);
  }

  const pageOpts: PageHandlerOptions = {
    ...options,
    getManifest: options.getManifest,
    actionHandlers: options.actionHandlers,
  };

  const handler = createPageHandler(pageOpts);
  const mount = options.path ?? '*';
  app.all(mount, handler);

  app.use(appBodyErrorHandler);

  return app;
}

/** Alias matching suggested API name. */
export { createAppServer as createApp };
