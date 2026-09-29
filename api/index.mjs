/**
 * demo-flight-app.vercel.app — the APP demo sites as a serverless function.
 *
 * Every /app/<site>/<slug> route runs through the real @agent-page/server
 * middleware via demo/full-server.mjs (negotiation, version pinning, CSRF,
 * idempotency, confirmation challenges, diffs, async jobs, rate limits, auth).
 * Sites are built per request origin so preview deployments work unchanged.
 *
 *   GET  /                     browsers → HTML landing; APP Accept → index manifest
 *   GET  /.well-known/agent-page  discovery document
 *   GET  /app/<site>/<slug>    page manifest (vnd.agent-page+json)
 *   POST /app/<site>/<slug>    action dispatch
 *   GET  /app-events           SSE/long-poll event channel (best-effort on serverless)
 *   POST /operations/*         async job status
 *   POST /app-oauth/token      token endpoint
 *   GET  /demo/files/<name>    stub bytes for file nodes
 *
 * Serverless note: page state is per-warm-instance (in-memory), so mutations
 * may reset on cold start — acceptable for a demo.
 */

import express from 'express';
import * as appServer from '@agent-page/server';
import { createFullDemoApp } from '../demo/full-server.mjs';
import { buildBaPages } from '../demo/british-airways/pages.mjs';
import { buildHotelPages } from '../demo/hotel-booking/pages.mjs';
import { buildGcPages } from '../demo/google-classroom/pages.mjs';
import { buildLabPages } from '../demo/protocol-lab/pages.mjs';
import { wellKnownManifest } from '../demo/lib/discovery.mjs';
import { str, obj, navAction } from '../demo/lib/nodes.mjs';

const MEDIA_PAGE = 'application/vnd.agent-page+json';
const STUB_PDF = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n%%EOF\n`;

// origin -> Promise<app>. Vercel reuses warm function instances, so each
// deployment origin gets one full demo app (state is per-instance anyway).
const apps = new Map();

function originOf(req) {
  const host = String(
    req.headers['x-forwarded-host'] || req.headers.host || 'demo-flight-app.vercel.app',
  )
    .split(',')[0]
    .trim();
  const proto =
    req.headers['x-forwarded-proto'] ||
    (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

// APP_DEMO_SITES=ba,hotel,gc,lab selects which demos a deployment serves —
// each vercel project (demo-flight-app, demo-hotel-app, …) sets its own.
const ENABLED = new Set(
  (process.env.APP_DEMO_SITES || 'ba,hotel,gc,lab')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function sitesFor(origin) {
  const sites = {};
  if (ENABLED.has('ba')) sites.ba = buildBaPages(origin);
  if (ENABLED.has('hotel')) sites.hotel = buildHotelPages(origin);
  if (ENABLED.has('gc')) sites.gc = buildGcPages(origin);
  if (ENABLED.has('lab')) sites.lab = buildLabPages(origin);
  for (const pages of Object.values(sites)) {
    for (const manifest of pages.values()) {
      for (const def of Object.values(manifest.actions ?? {})) {
        if (def && typeof def === 'object' && def.action_url == null) {
          def.action_url = manifest.page.url;
        }
      }
    }
  }
  return sites;
}

async function appFor(origin) {
  if (!apps.has(origin)) {
    apps.set(
      origin,
      createFullDemoApp({
        sites: sitesFor(origin),
        origin,
        deps: { express, server: appServer },
        log: () => {},
      }),
    );
  }
  return apps.get(origin);
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('access-control-allow-origin', '*');
  res.end(body);
};

const indexManifest = (origin) => ({
  app: '1.1',
  page: {
    id: 'demo_index',
    url: `${origin}/`,
    title: 'APP demos',
    version: 'demo-index-1',
    language: 'en',
  },
  state: {
    about: str(
      'APP demo sites — every route is a page manifest; actions post vnd.agent-page-action+json.',
      'About',
    ),
    demos: obj(
      Object.fromEntries(
        [
          ['ba', 'flight_booking', `${origin}/app/ba/home`, 'British Airways booking'],
          ['hotel', 'hotel_booking', `${origin}/app/hotel/search`, 'Hotel booking'],
          ['gc', 'classroom', `${origin}/app/gc/dash`, 'Classroom'],
          ['lab', 'protocol_lab', `${origin}/app/lab/home`, 'Feature lab'],
        ]
          .filter(([site]) => ENABLED.has(site))
          .map(([, key, url, label]) => [key, str(url, label)]),
      ),
      'Demos',
    ),
  },
  actions: {
    ...(ENABLED.has('ba')
      ? { open_flight_demo: navAction('Open the BA booking demo', `${origin}/app/ba/home`) }
      : {}),
    ...(ENABLED.has('lab')
      ? { open_lab: navAction('Open the protocol lab', `${origin}/app/lab/home`) }
      : {}),
    open_landing: navAction(
      'Open the human landing page',
      'https://agent-page-protocol.vercel.app',
    ),
  },
  meta: {
    human_landing: `${origin}/ (text/html)`,
    well_known: `${origin}/.well-known/agent-page`,
    landing: 'https://agent-page-protocol.vercel.app',
  },
});

const SITE_CARDS = {
  ba: [
    'British Airways booking',
    'search → fares → seats → passengers → pay → PNR',
    '/app/ba/home',
  ],
  hotel: ['Hotel booking', 'search → results → hotel → rates → checkout', '/app/hotel/search'],
  gc: ['Classroom', 'dashboard → stream → classwork → assignment → grades', '/app/gc/home'],
  lab: [
    'Protocol feature lab',
    'diffs, watch, async, consent, delegate, auth — every wire feature',
    '/app/lab/home',
  ],
};

const LANDING = (origin) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>APP demos</title>
<style>
body{margin:0;background:#0e1115;color:#e6edf3;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.55}
.w{max-width:760px;margin:0 auto;padding:56px 24px}
.c{display:inline-block;padding:4px 11px;margin-bottom:14px;border:1px solid #f08a4b88;border-radius:999px;font-size:11px;letter-spacing:.06em;color:#f08a4b}
h1{margin:0 0 8px;font-size:36px;letter-spacing:-.02em}
.sub{color:#9aa5b1;margin:0 0 30px}
a.d{display:block;background:#161b22;border:1px solid #2a3139;border-radius:12px;padding:16px 20px;margin-bottom:10px;color:inherit;text-decoration:none;transition:border-color .18s,transform .18s}
a.d:hover{border-color:#f08a4b;transform:translateY(-2px)}
a.d b{font-size:16px} a.d small{display:block;color:#9aa5b1}
a.d code{display:block;color:#f08a4b;font-size:12px;margin-top:6px;font-family:ui-monospace,monospace}
code{background:#1f2630;padding:1px 6px;border-radius:6px;font-size:.92em}
footer{margin-top:40px;color:#9aa5b1;font-size:13px} footer a{color:#f08a4b}
</style></head><body><div class="w">
<span class="c">AGENT PAGE PROTOCOL</span>
<h1>Live APP demos</h1>
<p class="sub">Every route serves an APP page manifest (<code>application/vnd.agent-page+json</code>) and accepts
<code>application/vnd.agent-page-action+json</code> POSTs — real middleware, real protocol.
Humans: open these with the Chrome extension installed; agents: fetch them directly.</p>
${Object.entries(SITE_CARDS)
  .filter(([site]) => ENABLED.has(site))
  .map(
    ([, [name, blurb, path]]) =>
      `<a class="d" href="${origin}${path}"><b>${name}</b><small>${blurb}</small><code>${origin}${path}</code></a>`,
  )
  .join('\n')}
<footer>Discovery: <a href="${origin}/.well-known/agent-page">/.well-known/agent-page</a> ·
Landing: <a href="https://agent-page-protocol.vercel.app">agent-page-protocol.vercel.app</a></footer>
</div></body></html>`;

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'https://placeholder');
  const path = url.pathname;
  const origin = originOf(req);

  if (path === '/') {
    const accept = String(req.headers.accept || '');
    if (accept.includes('vnd.agent-page')) {
      return send(res, 200, JSON.stringify(indexManifest(origin)), MEDIA_PAGE);
    }
    return send(res, 200, LANDING(origin), 'text/html; charset=utf-8');
  }
  if (path === '/.well-known/agent-page') {
    return send(res, 200, JSON.stringify(wellKnownManifest(origin, { auth: true })), MEDIA_PAGE);
  }
  if (path.startsWith('/demo/files/')) {
    return send(res, 200, STUB_PDF, 'application/pdf');
  }
  if (
    path.startsWith('/app/') ||
    path.startsWith('/operations/') ||
    path === '/app-events' ||
    path === '/app-oauth/token'
  ) {
    const app = await appFor(origin);
    return app(req, res);
  }

  res.statusCode = 303;
  res.setHeader('location', '/');
  res.setHeader('cache-control', 'no-store');
  res.end();
}
