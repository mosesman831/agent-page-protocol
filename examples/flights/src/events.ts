/**
 * SSE + long-poll event channel at /app-events (SPEC-v0.5 §14).
 * Long-poll is required whenever any events_* feature is advertised.
 */

import { randomBytes } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import express from 'express';
import { MEDIA_ERROR, buildErrorEnvelope } from '@agent-page/server';
import {
  MEDIA_EVENT,
  MEDIA_EVENT_STREAM,
  headerValue,
  isSameOrigin,
  selectedApp,
  type WireVersion,
} from './protocol.js';

const HISTORY_LIMIT = 100;
const HISTORY_MS = 15 * 60 * 1000;
const DEFAULT_LONGPOLL_MS = 25000;
const MIN_LONGPOLL_MS = 1000;
const MAX_LONGPOLL_MS = 30000;
const HEARTBEAT_MS = 15000;

export type EventType =
  | 'state.changed'
  | 'page.replaced'
  | 'action.completed'
  | 'session.expired'
  | 'hold.cleared'
  | 'challenge.updated'
  | 'order.updated'
  | 'consent.changed'
  | 'heartbeat';

export interface EventRecordBody {
  id: string;
  type: EventType | string;
  page_id: string;
  page_url: string;
  version: string;
  occurred_at: string;
  base_version?: string;
  hint: 'revalidate' | 'diff' | 'drop';
  diff?: unknown;
  pointers?: string[];
}

export interface EventRecord {
  app: WireVersion;
  event: EventRecordBody;
}

export class EventBus {
  private readonly events: EventRecordBody[] = [];
  private readonly waiters = new Set<(event: EventRecordBody) => void>();

  publish(
    type: EventType,
    opts: {
      pageId: string;
      pageUrl: string;
      version: string;
      hint?: EventRecordBody['hint'];
      pointers?: string[];
      baseVersion?: string;
    },
  ): EventRecordBody {
    const event: EventRecordBody = {
      id: `evt_${randomBytes(8).toString('hex')}`,
      type,
      page_id: opts.pageId,
      page_url: opts.pageUrl,
      version: opts.version,
      occurred_at: new Date().toISOString(),
      hint: opts.hint ?? 'revalidate',
    };
    if (opts.baseVersion) event.base_version = opts.baseVersion;
    if (opts.pointers) event.pointers = opts.pointers;
    this.events.push(event);
    const cutoff = Date.now() - HISTORY_MS;
    while (this.events.length > HISTORY_LIMIT) this.events.shift();
    while (this.events.length > 0) {
      const first = this.events[0]!;
      if (Date.parse(first.occurred_at) < cutoff) this.events.shift();
      else break;
    }
    for (const w of this.waiters) w(event);
    return event;
  }

  after(id: string | undefined, pageUrl?: string, types?: string[]): EventRecordBody[] {
    let start = 0;
    if (id) {
      const idx = this.events.findIndex((e) => e.id === id);
      start = idx >= 0 ? idx + 1 : this.events.length;
    }
    return this.events.slice(start).filter((e) => {
      if (pageUrl && e.page_url !== pageUrl && e.type !== 'heartbeat') return false;
      if (types && types.length > 0 && !types.includes(e.type)) return false;
      return true;
    });
  }

  subscribe(fn: (event: EventRecordBody) => void): () => void {
    this.waiters.add(fn);
    return () => {
      this.waiters.delete(fn);
    };
  }
}

function sendErr(
  res: Response,
  code: string,
  status: number,
  app: WireVersion,
  message?: string,
): void {
  const envelope = buildErrorEnvelope(code, { message, httpStatus: status });
  (envelope as { app: WireVersion }).app = app;
  res
    .status(status)
    .type(MEDIA_ERROR)
    .setHeader('X-APP-Version', app)
    .setHeader('X-APP-Response-Mode', 'error')
    .setHeader('Cache-Control', 'no-store')
    .json(envelope);
}

function writeSse(res: Response, record: EventRecord): void {
  res.write(`id: ${record.event.id}\n`);
  res.write(`event: ${record.event.type}\n`);
  res.write(`data: ${JSON.stringify(record)}\n\n`);
}

function recordFor(app: WireVersion, event: EventRecordBody): EventRecord {
  return { app, event };
}

export function createEventsRouter(pageOrigin: string, bus: EventBus): Router {
  const router = express.Router();

  router.use((req: Request, res: Response, next: import('express').NextFunction) => {
    if (
      req.method === 'POST' ||
      req.method === 'PUT' ||
      req.method === 'PATCH' ||
      req.method === 'DELETE'
    ) {
      const app = selectedApp(req.headers as Record<string, string | string[] | undefined>);
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      sendErr(res, 'app.err.transport.method_not_allowed', 405, app, 'Events channel is GET only');
      return;
    }
    next();
  });

  router.options('/', (_req: Request, res: Response) => {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    res.setHeader('X-APP-Version', '1.1');
    res.status(204).end();
  });

  const handleGet = (req: Request, res: Response) => {
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const app = selectedApp(headers);
    const pageUrl = typeof req.query.page_url === 'string' ? req.query.page_url : undefined;
    const typesRaw = typeof req.query.types === 'string' ? req.query.types : undefined;
    const types = typesRaw
      ? typesRaw
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;
    const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
    const after =
      (typeof req.query.after === 'string' ? req.query.after : undefined) ??
      headerValue(headers, 'last-event-id');

    if (pageUrl) {
      if (!isSameOrigin(pageUrl, pageOrigin)) {
        sendErr(res, 'app.err.security.cross_origin', 403, app, 'page_url must be same-origin');
        return;
      }
    }

    const accept = headerValue(headers, 'accept') ?? '';
    const wantsSse = /text\/event-stream/i.test(accept) && mode !== 'longpoll';
    const wantsLongpoll =
      mode === 'longpoll' || /application\/vnd\.agent-page-event\+json/i.test(accept);

    if (!wantsSse && !wantsLongpoll) {
      sendErr(
        res,
        'app.err.events.mode',
        400,
        app,
        'Use Accept: text/event-stream or mode=longpoll with application/vnd.agent-page-event+json',
      );
      return;
    }

    if (wantsSse) {
      res.status(200);
      res.setHeader('Content-Type', MEDIA_EVENT_STREAM);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-APP-Version', app);
      res.setHeader('X-APP-Response-Mode', 'event');
      res.write('retry: 3000\n\n');

      const replay = bus.after(after, pageUrl, types);
      for (const event of replay) {
        writeSse(res, recordFor(app, event));
      }

      const unsub = bus.subscribe((event) => {
        if (pageUrl && event.page_url !== pageUrl && event.type !== 'heartbeat') return;
        if (types && types.length > 0 && !types.includes(event.type)) return;
        writeSse(res, recordFor(app, event));
      });

      const hb = setInterval(() => {
        const beat: EventRecordBody = {
          id: `evt_hb_${Date.now().toString(36)}`,
          type: 'heartbeat',
          page_id: 'events',
          page_url: pageUrl ?? `${pageOrigin}/.well-known/agent-page`,
          version: 'v1',
          occurred_at: new Date().toISOString(),
          hint: 'revalidate',
        };
        writeSse(res, recordFor(app, beat));
      }, HEARTBEAT_MS);

      req.on('close', () => {
        clearInterval(hb);
        unsub();
      });
      return;
    }

    let timeoutMs = DEFAULT_LONGPOLL_MS;
    if (typeof req.query.timeout_ms === 'string') {
      const n = Number(req.query.timeout_ms);
      if (!Number.isFinite(n)) {
        sendErr(res, 'app.err.events.mode', 400, app, 'timeout_ms must be a number');
        return;
      }
      timeoutMs = Math.min(MAX_LONGPOLL_MS, Math.max(MIN_LONGPOLL_MS, n));
    }

    const existing = bus.after(after, pageUrl, types);
    if (existing.length > 0) {
      const event = existing[0]!;
      res
        .status(200)
        .type(MEDIA_EVENT)
        .setHeader('X-APP-Version', app)
        .setHeader('X-APP-Response-Mode', 'event')
        .setHeader('Cache-Control', 'no-store')
        .json(recordFor(app, event));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      res.status(204).setHeader('X-APP-Version', app).setHeader('Cache-Control', 'no-store').end();
    }, timeoutMs);

    const unsub = bus.subscribe((event) => {
      if (settled) return;
      if (pageUrl && event.page_url !== pageUrl && event.type !== 'heartbeat') return;
      if (types && types.length > 0 && !types.includes(event.type)) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      res
        .status(200)
        .type(MEDIA_EVENT)
        .setHeader('X-APP-Version', app)
        .setHeader('X-APP-Response-Mode', 'event')
        .setHeader('Cache-Control', 'no-store')
        .json(recordFor(app, event));
    });

    req.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
    });
  };

  router.get('/', handleGet);
  router.get('', handleGet);

  return router;
}
