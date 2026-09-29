#!/usr/bin/env node
/**
 * Generates data/site.json + data/wellknown.json for the agent-page-protocol
 * landing deploy. Run: `node deploy/protocol-site/build-site.mjs` (or via the
 * npm script `site:build`). Output is committed — the Vercel project is fully
 * self-contained and needs no repo access at deploy time.
 *
 * The site is itself an APP page (dogfooding): `/manifest.app.json` serves the
 * manifest below; `/` negotiates (APP Accept → manifest, browsers → /html).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { str, markdown, obj, arr, navAction } from '../../demo/lib/nodes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://agent-page-protocol.vercel.app';
const DEMO_FLIGHT = 'https://demo-flight-app.vercel.app';
const DEMO_HOTEL = 'https://demo-hotel-app-eta.vercel.app';
const DEMO_CLASSROOM = 'https://demo-classroom-app.vercel.app';
const DEMO_LAB = 'https://demo-lab-app.vercel.app';
const REPO = 'https://github.com/mosesman831/agent-page-protocol';
const SPECREPO = 'https://github.com/mosesman831/APP-specs';

const feature = (layer, what) =>
  obj(
    { layer: str(layer), what: str(what) },
    `${layer}-${what}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 40),
  );

const benefit = (name, detail) =>
  obj(
    { benefit: str(name), detail: str(detail) },
    `b-${name}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 40),
  );

const bench = (metric, html, app, note) =>
  obj(
    { metric: str(metric), html: str(html), app: str(app), note: str(note) },
    `m-${metric}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 40),
  );

const site = {
  app: '1.1',
  page: {
    id: 'app_home',
    url: `${ORIGIN}/`,
    title: 'Agent Page Protocol',
    version: 'app-landing-1',
    language: 'en',
  },
  state: {
    headline: str(
      'Web pages as JSON manifests — agents read them, humans see them rendered.',
      'Agent Page Protocol',
    ),
    about: markdown(
      '**APP** replaces HTML/DOM as the unit a page serves.\n\n' +
        '- `GET` a page → a **page manifest**: typed state nodes, declared actions, presentation hints.\n' +
        '- `POST` an action → the next manifest or an RFC 6902 **diff** document.\n' +
        '- One document, two readers: the Chrome extension renders manifests for humans; agents drive the same documents via MCP, CLI or SDK.\n\n' +
        'Canonical manifest URL: [/manifest.app.json](' +
        ORIGIN +
        '/manifest.app.json)',
      'What it is',
    ),
    for_humans: markdown(
      'No extension? The HTML edition lives at [/html](' +
        ORIGIN +
        '/html). Get the renderer at [app-extension.zip](' +
        ORIGIN +
        '/app-extension.zip) — unzip, chrome://extensions, Developer mode, Load unpacked. ' +
        'With the extension installed, every APP page renders as a normal site.',
      'For humans',
    ),
    for_agents: markdown(
      'Ingest this page as APP: `GET ' +
        ORIGIN +
        '/manifest.app.json` with header `Accept: application/vnd.agent-page+json`. ' +
        'Actions post `application/vnd.agent-page-action+json` to `action_url`. ' +
        'Capabilities are advertised at `/.well-known/agent-page`.',
      'For agents',
    ),
    demos: obj(
      {
        flight_booking: str(`${DEMO_FLIGHT}/app/ba/home`, 'British Airways booking'),
        hotel_booking: str(`${DEMO_HOTEL}/app/hotel/search`, 'Hotel booking'),
        classroom: str(`${DEMO_CLASSROOM}/app/gc/home`, 'Classroom'),
        protocol_lab: str(`${DEMO_LAB}/app/lab/home`, 'Feature lab'),
      },
      'Live demos',
    ),
    connect: obj(
      {
        mcp_server: str(
          `${REPO}/tree/main/packages/mcp`,
          'MCP server (stdio) — app_read/app_act/app_events',
        ),
        agent_cli: str(`${REPO}/tree/main/packages/cli`, 'Agent CLI (state-driven commands)'),
        ts_client: str(`${REPO}/tree/main/packages/client`, 'TypeScript client SDK'),
        ingest_one_liner: str(
          `curl -H 'Accept: application/vnd.agent-page+json' ${ORIGIN}/`,
          'Ingest this page in one line',
        ),
      },
      'Connect an agent',
    ),
    benefits: arr(
      [
        benefit(
          '~100x smaller pages',
          '328 KB of HTML + JS/CSS vs a 3.3 KB manifest for identical content',
        ),
        benefit(
          'Typed values',
          "price = { type:'number', scale:2, unit:'GBP' } — no scraping, no inference",
        ),
        benefit(
          'Declared actions',
          'every action ships an input schema — zero guessing what a button does',
        ),
        benefit('Diff updates', 'RFC 6902 JSON Patch deltas — ~89% fewer bytes than re-fetching'),
        benefit(
          'Safe by default',
          'idempotency keys, version pinning, confirmation challenges, delegated OAuth scopes',
        ),
        benefit(
          'Humans included',
          'the same manifest renders as a real site via the Chrome MV3 extension',
        ),
      ],
      'Why APP',
    ),
    benchmarks: arr(
      [
        bench(
          'Page transfer',
          '~328 KB HTML+assets',
          '3.3 KB manifest',
          '~100x smaller, same content',
        ),
        bench(
          'Full booking flow',
          '40+ DOM interactions',
          '7 protocol round trips',
          'search→filter→select→book→confirm',
        ),
        bench('Tokens per page', '~891 (doc only)', '~833', 'doc parity — transfer is the win'),
        bench(
          'Sequential updates',
          'full re-fetch each step',
          '88.9% bytes saved',
          '10 diffs (3.7 KB) vs 10 re-fetches (33.3 KB)',
        ),
        bench('Cache revalidation', '—', '0-byte body', 'ETag → 304, measured'),
        bench('Flow latency (p50)', '—', '~6.6 ms', 'sum of step p50s, localhost'),
      ],
      'Benchmarks — same content in both representations',
    ),
    schemas: obj(
      {
        page_manifest: str(`${REPO}/blob/main/schema/manifest.json`, 'page manifest'),
        state_node: str(`${REPO}/blob/main/schema/state-node.json`, 'state node (20 kinds)'),
        action_def: str(`${REPO}/blob/main/schema/action-def.json`, 'action definition'),
        action_request: str(`${REPO}/blob/main/schema/action-request.json`, 'action request'),
        diff_document: str(
          `${REPO}/blob/main/schema/diff-document.json`,
          'diff document (RFC 6902)',
        ),
        error_envelope: str(`${REPO}/blob/main/schema/error-envelope.json`, 'error envelope'),
        spec: str(`${SPECREPO}/blob/main/SPEC.md`, 'protocol spec (private repo)'),
      },
      'Manifest schemas & spec',
    ),
    links: obj(
      {
        github: str(REPO, 'Repository'),
        docs: str(`${REPO}/tree/main/docs`, 'Docs'),
        benchmarks_source: str(`${REPO}/tree/main/benchmarks`, 'Benchmark methodology'),
        extension: str(`${REPO}/tree/main/extension`, 'Chrome extension source'),
        extension_download: str(`${ORIGIN}/app-extension.zip`, 'Chrome extension (zip, v0.5)'),
        adopt_prompt: str(
          `${REPO}/blob/main/docs/adopt-prompt.md`,
          'Adoption prompt for coding agents',
        ),
        migration_canonical: str(
          `${REPO}/blob/main/docs/canonicalmigration.md`,
          'Guide: APP alongside DOM via Accept negotiation',
        ),
        migration_full: str(
          `${REPO}/blob/main/docs/fullmigration.md`,
          'Guide: manifests as the page documents',
        ),
        use_prompt: str(
          `${REPO}/blob/main/docs/use-prompt.md`,
          'Setup prompt: give an agent APP access',
        ),
        agent_setup: str(
          `${REPO}/blob/main/docs/agent-setup.md`,
          'Guide: add the APP MCP server / CLI to an agent',
        ),
      },
      'Links',
    ),
    protocol_surface: arr(
      [
        feature('document', 'typed state nodes (20 kinds), present hints, navigation'),
        feature('document', 'conditional GET + watch + ETag'),
        feature('action', 'idempotency keys, version pinning, confirmation challenges'),
        feature('action', 'diff responses (RFC 6902), async 202 jobs, bulk ops'),
        feature('agent', 'delegated OAuth scopes, consent gate, rate limits'),
        feature('agent', 'SSE + long-poll event channel, error envelopes'),
        feature('human', 'MV3 extension renderer, theme system, component hints'),
      ],
      'Protocol surface',
    ),
  },
  actions: {
    open_human_version: navAction(
      'Open the HTML version of this page (for humans without the extension)',
      `${ORIGIN}/html`,
    ),
    open_flight_demo: navAction(
      'Open the British Airways booking demo',
      `${DEMO_FLIGHT}/app/ba/home`,
    ),
    open_hotel_demo: navAction('Open the hotel booking demo', `${DEMO_HOTEL}/app/hotel/search`),
    open_classroom_demo: navAction('Open the classroom demo', `${DEMO_CLASSROOM}/app/gc/home`),
    open_protocol_lab: navAction('Open the protocol feature lab', `${DEMO_LAB}/app/lab/home`),
    ingest_manifest: navAction(
      'Ingest this page as an APP manifest (canonical agent URL)',
      `${ORIGIN}/manifest.app.json`,
    ),
    open_schemas: navAction('Browse the manifest JSON Schemas', `${REPO}/tree/main/schema`),
    open_mcp: navAction('Connect your agent via the MCP server', `${REPO}/tree/main/packages/mcp`),
    open_repo: navAction('Open the source repository', REPO),
  },
  navigation: {
    breadcrumb: [{ label: 'Agent Page Protocol', url: `${ORIGIN}/` }],
  },
  present: {
    layout: 'detail',
    sections: [
      { id: 's_headline', label: 'Welcome', layout: 'detail', state_path: 'headline' },
      { id: 's_about', label: 'What it is', layout: 'detail', state_path: 'about' },
      { id: 's_humans', label: 'For humans', layout: 'detail', state_path: 'for_humans' },
      { id: 's_agents', label: 'For agents', layout: 'detail', state_path: 'for_agents' },
      { id: 's_demos', label: 'Live demos', layout: 'detail', state_path: 'demos' },
      { id: 's_connect', label: 'Connect an agent', layout: 'detail', state_path: 'connect' },
      { id: 's_benefits', label: 'Why APP', layout: 'table', state_path: 'benefits' },
      { id: 's_benchmarks', label: 'Benchmarks', layout: 'table', state_path: 'benchmarks' },
      {
        id: 's_surface',
        label: 'Protocol surface',
        layout: 'table',
        state_path: 'protocol_surface',
      },
      { id: 's_schemas', label: 'Schemas', layout: 'detail', state_path: 'schemas' },
      { id: 's_links', label: 'Links', layout: 'detail', state_path: 'links' },
      {
        id: 'f_human',
        label: 'Human version',
        layout: 'form',
        primary_action: 'open_human_version',
      },
      {
        id: 'f_ingest',
        label: 'Ingest (agents)',
        layout: 'form',
        primary_action: 'ingest_manifest',
      },
      { id: 'f_flight', label: 'Flight demo', layout: 'form', primary_action: 'open_flight_demo' },
      { id: 'f_schemas', label: 'Schemas', layout: 'form', primary_action: 'open_schemas' },
      { id: 'f_repo', label: 'Repository', layout: 'form', primary_action: 'open_repo' },
    ],
  },
  meta: {
    title: 'Agent Page Protocol',
    description: 'Web pages as JSON manifests — readable by agents, rendered for humans.',
    agent: {
      canonical_manifest: `${ORIGIN}/manifest.app.json`,
      media_type: 'application/vnd.agent-page+json',
      action_media_type: 'application/vnd.agent-page-action+json',
      well_known: `${ORIGIN}/.well-known/agent-page`,
      demos: {
        flight: DEMO_FLIGHT,
        hotel: DEMO_HOTEL,
        classroom: DEMO_CLASSROOM,
        lab: DEMO_LAB,
      },
      repo: REPO,
    },
  },
};

const wellknown = {
  app: '1.1',
  page: {
    id: 'well-known',
    url: `${ORIGIN}/.well-known/agent-page`,
    title: 'Agent Page Protocol — discovery',
    version: 'wk-1',
  },
  state: {
    site_name: str('Agent Page Protocol'),
    site_type: str('landing'),
    protocol_version: str('1.1'),
    capabilities: {
      type: 'array',
      value: ['manifest', 'navigate', 'present'].map((c) => str(c)),
    },
    entry_urls: obj(
      {
        home_manifest: str(`${ORIGIN}/manifest.app.json`),
        home_html: str(`${ORIGIN}/html`),
        demos: str(`${DEMO_FLIGHT}/`),
        repo: str(REPO),
      },
      'Entry URLs',
    ),
  },
};

await mkdir(join(HERE, 'data'), { recursive: true });
await writeFile(join(HERE, 'data', 'site.json'), JSON.stringify(site, null, 2) + '\n');
await writeFile(join(HERE, 'data', 'wellknown.json'), JSON.stringify(wellknown, null, 2) + '\n');
console.log('wrote data/site.json + data/wellknown.json');
