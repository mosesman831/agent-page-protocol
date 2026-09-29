#!/usr/bin/env node
/**
 * Demo server for the APP demo sites. Serves:
 *
 *   GET  /                      -> demo viewer (index.html)
 *   GET  /demo/viewer.js        -> viewer module
 *   GET  /demo/pages.json       -> { site: [{ slug, title }] } for the picker
 *   GET  /app/<site>/<slug>     -> page manifest (application/vnd.agent-page+json)
 *   POST /app/<site>/<slug>     -> action dispatch; returns ACTION_RESULT payload
 *                                  ({ mode: 'full', document }) following each
 *                                  action's output.navigates_to
 *   GET  /extension/...         -> extension sources (renderer, styles, fonts)
 *   GET  /demo/files/<name>     -> stub file bytes (PDFs/JPEGs referenced in state)
 *
 * Usage: npm run demo   (default http://127.0.0.1:8788, PORT env overrides)
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBaPages } from './british-airways/pages.mjs';
import { buildHotelPages } from './hotel-booking/pages.mjs';
import { buildGcPages } from './google-classroom/pages.mjs';
import { buildLabPages } from './protocol-lab/pages.mjs';
import { buildMvaPages } from './multiversal/pages.mjs';
import { mvaSkin } from './multiversal/skin.mjs';
import { gcSkin } from './google-classroom/skin.mjs';
import { labSkin } from './protocol-lab/skin.mjs';
import { hotelSkin } from './hotel-booking/skin.mjs';
import { wellKnownManifest } from './lib/discovery.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // repo root
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8788);
const ORIGIN = `http://${HOST}:${PORT}`;
const MEDIA_PAGE = 'application/vnd.agent-page+json';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const SITES = {
  ba: buildBaPages(ORIGIN),
  hotel: buildHotelPages(ORIGIN),
  gc: buildGcPages(ORIGIN),
  lab: buildLabPages(ORIGIN),
  mva: buildMvaPages(ORIGIN),
};
const SKINS = {
  mva: mvaSkin(ORIGIN),
  gc: gcSkin(ORIGIN),
  lab: labSkin(ORIGIN),
  hotel: hotelSkin(ORIGIN),
};

// Full protocol stack (negotiation, etag/304, idempotency, confirmation,
// diffs, async, rate-limit, challenges) via the real @agent-page/server
// middleware — available once `npm run build` has produced packages/server
// dist. Without it the demo still runs in basic mode (GET/POST only).
let fullApp = null;
try {
  const { createFullDemoApp } = await import('./full-server.mjs');
  fullApp = await createFullDemoApp({
    sites: SITES,
    origin: ORIGIN,
    skins: SKINS,
    log: (m) => console.log('[full]', m),
  });
} catch (e) {
  console.warn(`[demo] basic mode — full protocol stack unavailable (${e.message})`);
}

// Action POSTs target `action_url` (SPEC action-def); this demo resolves the
// action on the manifest that owns it, so default every action_url to the
// page.url of the manifest declaring it. Clients that post to page.url after
// in-place renders (the extension tracks the fetch URL, not page.url) would
// otherwise hit the wrong manifest and get app.err.action.unknown.
for (const pages of Object.values(SITES)) {
  for (const manifest of pages.values()) {
    for (const def of Object.values(manifest.actions ?? {})) {
      if (def && typeof def === 'object' && def.action_url == null) {
        def.action_url = manifest.page.url;
      }
    }
  }
}

const MEDIA_ERROR = 'application/vnd.agent-page-error+json';

const STUB_PDF = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n%%EOF\n`;

// Issued confirmation challenges (requires_confirmation actions, SPEC §7.4).
const confirmTokens = new Set();

const str = (value, label) => ({ type: 'string', value, ...(label ? { label } : {}) });

function sendError(res, status, code, message, extra = {}) {
  const envelope = {
    app: '1.1',
    error: { code, message, retryable: status < 500, http_status: status, ...extra },
  };
  sendJson(res, status, JSON.stringify(envelope), MEDIA_ERROR);
}

function sendJson(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(data);
}

async function serveFile(res, rel) {
  const path = normalize(join(ROOT, rel));
  if (!path.startsWith(ROOT)) return sendJson(res, 403, 'forbidden', 'text/plain');
  try {
    const data = await readFile(path);
    res.writeHead(200, {
      'content-type': MIME[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, 'not found', 'text/plain');
  }
}

const readBody = (req) =>
  new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(buf || '{}'));
      } catch {
        resolve({});
      }
    });
  });

function pagesIndex() {
  const out = {};
  for (const [site, pages] of Object.entries(SITES)) {
    out[site] = [...pages.values()].map((m) => ({
      slug: m.page.url.split('/').pop(),
      title: m.page.title,
    }));
  }
  return out;
}

function findByUrl(site, url) {
  for (const [slug, m] of SITES[site] ?? []) {
    if (m.page.url === url || m.page.url.endsWith(`/app/${site}/${slug}`)) {
      if (m.page.url === url) return [slug, m];
    }
  }
  // second pass: suffix match (covers navigates_to written relative)
  for (const [slug, m] of SITES[site] ?? []) {
    if (url.endsWith(`/app/${site}/${slug}`)) return [slug, m];
  }
  return [null, null];
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', ORIGIN);
  const path = url.pathname;

  const isGet = req.method === 'GET' || req.method === 'HEAD';
  if (isGet && (path === '/' || path === '/demo' || path === '/demo/')) {
    return serveFile(res, 'demo/index.html');
  }
  if (isGet && path === '/demo/pages.json') {
    return sendJson(res, 200, pagesIndex());
  }
  if (isGet && path.startsWith('/demo/files/')) {
    // Real files under demo/files/ first (images, documents); stub PDF fallback.
    const rel = normalize(join('demo/files', path.slice('/demo/files/'.length)));
    const abs = normalize(join(ROOT, rel));
    if (abs.startsWith(join(ROOT, 'demo/files'))) {
      try {
        const data = await readFile(abs);
        res.writeHead(200, {
          'content-type': MIME[extname(abs)] || 'application/octet-stream',
          'cache-control': 'public, max-age=300',
        });
        return res.end(data);
      } catch {
        /* fall through to stub */
      }
    }
    res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
    return res.end(STUB_PDF);
  }

  if (isGet && path === '/.well-known/agent-page') {
    return sendJson(
      res,
      200,
      JSON.stringify(wellKnownManifest(ORIGIN, { auth: !!fullApp })),
      MEDIA_PAGE,
    );
  }

  // Full-stack path: real middleware for /app/*, async jobs and the event
  // channel when the workspace build exists; otherwise the basic handler.
  if (
    fullApp &&
    (path.startsWith('/app/') ||
      path.startsWith('/site/') ||
      path.startsWith('/operations/') ||
      path === '/app-events' ||
      path === '/app-oauth/token')
  ) {
    return fullApp(req, res);
  }

  const appMatch = /^\/app\/(ba|hotel|gc|lab|mva)\/([a-z0-9-]+)$/.exec(path);
  if (appMatch) {
    const [, site, slug] = appMatch;
    const manifest = SITES[site]?.get(slug);
    if (!manifest)
      return sendError(res, 404, 'app.err.page.unknown', `No demo page ${site}/${slug}`);

    if (isGet) {
      return sendJson(res, 200, JSON.stringify(manifest), MEDIA_PAGE);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const actionId = body.action;
      const def = manifest.actions?.[actionId];
      if (!def) {
        return sendError(res, 400, 'app.err.action.unknown', `Unknown action '${actionId}'`);
      }
      if (def.requires_confirmation === true) {
        const confirm =
          typeof req.headers['x-app-confirmation'] === 'string'
            ? req.headers['x-app-confirmation']
            : null;
        if (!confirm || !confirmTokens.has(confirm)) {
          const token = `conf_${Math.random().toString(36).slice(2, 10)}`;
          confirmTokens.add(token);
          return sendError(
            res,
            428,
            'app.err.action.confirmation_required',
            `Confirm: ${def.description}`,
            { details: { confirmation_challenge: str(token) } },
          );
        }
        confirmTokens.delete(confirm);
      }
      const target = def.output?.navigates_to;
      let doc = manifest;
      if (target) {
        const [, targetDoc] = findByUrl(site, target);
        if (targetDoc) doc = targetDoc;
      }
      return sendJson(res, 200, JSON.stringify(doc), MEDIA_PAGE);
    }
  }

  if (isGet && (path.startsWith('/extension/') || path.startsWith('/demo/'))) {
    return serveFile(res, path.slice(1));
  }

  return sendJson(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, HOST, () => {
  console.log(`APP demo server: ${ORIGIN}`);
  console.log(`  viewer:  ${ORIGIN}/`);
  for (const site of Object.keys(SITES)) {
    console.log(`  ${site}: ${[...SITES[site].keys()].join(', ')}`);
  }
});
