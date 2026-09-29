import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import ShaderHero from '../components/ShaderHero';
import CopyBlock from '../components/CopyBlock';
import CopyBtn from '../components/CopyBtn';

const REPO = 'https://github.com/mosesman831/agent-page-protocol';
const SPECREPO = 'https://github.com/mosesman831/APP-specs';
const ORIGIN = 'https://agent-page-protocol.vercel.app';

const CURL_INGEST = `curl -H 'Accept: application/vnd.agent-page+json' \\
     ${ORIGIN}/`;

const ACTION_CALL = `POST /app/ba/home
Content-Type: application/vnd.agent-page-action+json

{"app":"1.1","action":"search_flights",
 "params":{"from":"lhr","to":"jfk","depart":"2026-10-05"}}`;

// Keep in sync with docs/use-prompt.md (the fenced block is the same text).
const USE_PROMPT = `Your environment can speak Agent Page Protocol (APP) — JSON page manifests +
typed actions instead of scraping HTML/DOM.

Set it up by following this guide:
https://github.com/mosesman831/agent-page-protocol/blob/main/docs/agent-setup.md

Read it, configure the APP MCP server (or the CLI path if MCP isn't available
in this client), then verify by opening
https://demo-lab-app.vercel.app/app/lab/home and reading its manifest.
Tell me when you're connected and which APP tools you can see.`;

const MCP_INSTALL = `# 1. build the server once:
git clone ${REPO} && cd agent-page-protocol
npm ci && npm run build

# 2. add to your MCP client config:
{
  "mcpServers": {
    "agent-page": {
      "command": "node",
      "args": ["/path/to/agent-page-protocol/packages/mcp/dist/bin.js"]
    }
  }
}`;

const AGENT_PROMPT = `You can browse and act on Agent Page Protocol (APP) sites.

GET a page URL with header 'Accept: application/vnd.agent-page+json' — you
receive a JSON page manifest: typed state + declared actions.

To act, POST to the action's action_url with
'Content-Type: application/vnd.agent-page-action+json', body
{"app":"1.1","action":"<id>","params":{...}}. Add
'X-APP-Accept-Versions: 1.1' and 'X-APP-Idempotency-Key' (>=8 chars) on
non-idempotent calls. Financial actions may reply 428 — resend with
'X-APP-Confirmation'. Actions return the next manifest or an RFC 6902 diff.

Try it: https://demo-lab-app.vercel.app/app/lab/home
Discovery: /.well-known/agent-page · Spec: ${SPECREPO}/blob/main/SPEC.md`;

// Keep in sync with docs/adopt-prompt.md (the fenced block is the same text).
const ADOPT_PROMPT = `You are an APP adoption agent. APP (Agent Page Protocol) replaces HTML/DOM as
the canonical page representation: each page is a JSON manifest of typed state
plus declared actions. Agents read and act on manifests over HTTP; a Chrome
extension renders the same document for humans. Repo:
https://github.com/mosesman831/agent-page-protocol

STEP 1 — Ask me which migration I want, then wait for my answer:
  1. FULL — APP manifests become the site's page documents; HTML becomes a
     thin fallback (extension required) or is removed entirely.
  2. CANONICAL + NEGOTIATION — keep the DOM for humans; serve manifests to
     clients that send 'Accept: application/vnd.agent-page+json'
     (auto-negotiated on the same URLs).

STEP 2 — Fetch the live schema set (never assume; pull before designing):
  https://raw.githubusercontent.com/mosesman831/agent-page-protocol/main/schema/manifest.json
  https://raw.githubusercontent.com/mosesman831/agent-page-protocol/main/schema/state-node.json
  https://raw.githubusercontent.com/mosesman831/agent-page-protocol/main/schema/action-def.json
  https://raw.githubusercontent.com/mosesman831/agent-page-protocol/main/schema/action-request.json
  https://raw.githubusercontent.com/mosesman831/agent-page-protocol/main/schema/diff-document.json
  https://raw.githubusercontent.com/mosesman831/agent-page-protocol/main/schema/error-envelope.json

STEP 3 — Read the migration guide matching my choice and follow it:
  canonical → https://github.com/mosesman831/agent-page-protocol/blob/main/docs/canonicalmigration.md
  full      → https://github.com/mosesman831/agent-page-protocol/blob/main/docs/fullmigration.md

STEP 4 — Inventory this codebase: enumerate every page/route and its data
  model, then propose one manifest per page (state nodes + actions). Show me
  the mapping and wait for approval before writing code.

STEP 5 — Implement. Prefer @agent-page/server (Express middleware:
  negotiation, diffs, CSRF, idempotency, confirmation, async, well-known) over
  hand-rolled emitters. Respect the wire contract:
    GET  page URL  + Accept: application/vnd.agent-page+json → Page Manifest
    POST action_url + Content-Type: application/vnd.agent-page-action+json
         body {"app":"1.1","action":"<id>","params":{...}}
         → next manifest, RFC 6902 diff, or error envelope
    X-APP-Idempotency-Key required on non-idempotent actions;
    X-APP-If-Match-Version on versioned actions (428 = resend with it);
    financial actions may 428 — resend with X-APP-Confirmation.

STEP 6 — Validate every emitted manifest against the schema (ajv, or the
  repo's 'npm run schema:check'), run the repo's conformance vectors if
  applicable, then show me how to verify both readers:
    agent:  curl -H 'Accept: application/vnd.agent-page+json' <page-url>
    human:  the Chrome extension (Load unpacked → extension/, or
            https://agent-page-protocol.vercel.app/app-extension.zip)`;

const DEMOS: [string, string, string][] = [
  [
    'British Airways booking',
    'Full flow: search → fares → seat map → passengers → payment → PNR.',
    'https://demo-flight-app.vercel.app/app/ba/home',
  ],
  [
    'Hotel booking',
    'Search → results → hotel → rooms & rates → checkout → confirmation.',
    'https://demo-hotel-app-eta.vercel.app/app/hotel/search',
  ],
  [
    'Classroom',
    'Dashboard → stream → classwork → assignment → grades → people.',
    'https://demo-classroom-app.vercel.app/app/gc/home',
  ],
  [
    'Protocol feature lab',
    'Every wire feature end-to-end: diffs, watch, async, consent, delegate, auth.',
    'https://demo-lab-app.vercel.app/app/lab/home',
  ],
];

const SCHEMAS: [string, string][] = [
  ['manifest.json — the page', `${REPO}/blob/main/schema/manifest.json`],
  ['state-node.json — 20 node kinds', `${REPO}/blob/main/schema/state-node.json`],
  ['action-def.json — action definition', `${REPO}/blob/main/schema/action-def.json`],
  ['action-request.json — the POST body', `${REPO}/blob/main/schema/action-request.json`],
  ['diff-document.json — RFC 6902', `${REPO}/blob/main/schema/diff-document.json`],
  ['error-envelope.json', `${REPO}/blob/main/schema/error-envelope.json`],
  ['SPEC.md — the protocol (private repo)', `${SPECREPO}/blob/main/SPEC.md`],
];

const BENCHES: [string, string, string, string][] = [
  ['Page transfer', '~328 KB', '3.3 KB', '~100× smaller, same content'],
  [
    'Full booking flow',
    '40+ DOM interactions',
    '7 round trips',
    'search → filter → select → book → confirm',
  ],
  ['Tokens per page', '~891 (doc only)', '~833', 'doc parity — transfer is the win'],
  [
    'Sequential updates',
    'full re-fetch each step',
    '88.9% bytes saved',
    '10 diffs (3.7 KB) vs 10 re-fetches (33.3 KB)',
  ],
  ['Cache revalidation', '—', '0-byte body', 'ETag → 304, measured'],
  ['Flow latency (p50)', '—', '~6.6 ms', 'sum of step p50s, localhost'],
];

const BENEFITS: [string, string][] = [
  ['~100× smaller pages', '328 KB of HTML + JS/CSS vs a 3.3 KB manifest for identical content.'],
  ['Typed values', "price = {type:'number', scale:2, unit:'GBP'} — no scraping, no inference."],
  ['Declared actions', 'Every action ships an input schema — zero guessing what a button does.'],
  ['Diff updates', 'RFC 6902 JSON Patch deltas — ~89% fewer bytes than re-fetching.'],
  [
    'Safe by default',
    'Idempotency keys, version pinning, confirmation challenges, delegated OAuth scopes.',
  ],
  ['Humans included', 'The same manifest renders as a real site via the Chrome MV3 extension.'],
];

const FEATURES: [string, string][] = [
  [
    'Document',
    'Typed state nodes (20 kinds) · present hints · navigation · conditional GET · watch + ETag',
  ],
  [
    'Actions',
    'Idempotency keys · version pinning · confirmation challenges · RFC 6902 diffs · async 202 jobs · bulk ops',
  ],
  [
    'Agent safety',
    'Delegated OAuth scopes · consent gate · rate limits · structured error envelopes',
  ],
  [
    'Events',
    'Server-sent events + long-poll channel — pages push state changes to watching agents',
  ],
  [
    'Human layer',
    'MV3 extension renderer · theme system · component hints (charts, calendars, steppers)',
  ],
  [
    'Tooling',
    'Conformance suite · manifest generator + mutants · schema-validated corpus · benchmarks',
  ],
];

export default async function Home() {
  // APP-first: agents asking for the manifest are sent to the canonical URL.
  const accept = (await headers()).get('accept') ?? '';
  if (accept.includes('application/vnd.agent-page+json')) redirect('/manifest.app.json');

  return (
    <>
      <nav>
        <div className="w">
          <a className="logo" href="/">
            Agent<b>Page</b>Protocol
          </a>
          <a className="nl hidesm" href="#connect">
            Connect
          </a>
          <a className="nl hidesm" href="#adopt">
            Adopt
          </a>
          <a className="nl hidesm" href="#benefits">
            Why
          </a>
          <a className="nl" href="#benchmarks">
            Benchmarks
          </a>
          <a className="nl hidesm" href="#schemas">
            Schemas
          </a>
          <a className="nl" href="#demos">
            Demos
          </a>
          <span className="sp" />
          <a className="gh" href={REPO}>
            <svg width="15" height="15" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span className="gh-t">GitHub</span>
          </a>
        </div>
      </nav>

      <header className="hero">
        <ShaderHero />
        <div className="w">
          <span className="chip">AGENT PAGE PROTOCOL · v1.1</span>
          <h1>
            Web pages for <em>agents</em>. Rendered for <em>humans</em>.
          </h1>
          <p className="sub">
            APP replaces HTML/DOM as the unit a page serves: a typed JSON <b>page manifest</b> with
            declared actions. One document — agents read it directly, the Chrome extension renders
            it as a normal site.
          </p>
          <div className="ctas">
            <a className="btn btn-pri" href="#connect">
              Connect your agent →
            </a>
            <a className="btn btn-sec" href="#demos">
              See it live
            </a>
            <a className="btn btn-sec" href={REPO}>
              View on GitHub
            </a>
            <a className="btn btn-sec" href="/app-extension.zip" download>
              Download extension
            </a>
          </div>
          <CopyBlock label="this page is an APP document — ingest it" code={CURL_INGEST} />
          <p className="fine">
            You&apos;re reading the HTML edition. With the{' '}
            <a href="/app-extension.zip">extension</a>, <code>/</code> itself renders as this page.{' '}
            Install: unzip → <code>chrome://extensions</code> → Developer mode → Load unpacked.
          </p>
        </div>
      </header>

      <main>
        <section id="connect">
          <div className="w">
            <p className="kicker">Connect</p>
            <h2>Give it to your agent</h2>
            <p className="sdesc">
              Three ways in — same protocol underneath. Copy a block, paste it where your agent
              lives.
            </p>
            <div className="ctas" style={{ marginBottom: 14 }}>
              <CopyBtn code={USE_PROMPT}>copy the setup prompt →</CopyBtn>
              <CopyBtn className="btn btn-sec" code={AGENT_PROMPT}>
                copy the wire-protocol prompt
              </CopyBtn>
            </div>
            <p className="fine" style={{ marginTop: 0 }}>
              Prompts point your agent at{' '}
              <a href={`${REPO}/blob/main/docs/agent-setup.md`}>docs/agent-setup.md</a> — MCP server
              install, CLI path, verify steps.
            </p>
            <CopyBlock label="install the MCP server" code={MCP_INSTALL} />
            <div className="stack" style={{ marginTop: 14 }}>
              <CopyBlock
                label="act on a page — one declared action, typed params"
                code={ACTION_CALL}
              />
            </div>
            <div className="grid" style={{ marginTop: 14 }}>
              <a className="card" href={`${REPO}/tree/main/packages/mcp`}>
                <h3>MCP server</h3>
                <p>
                  Drop-in stdio server: <code>app_read</code>, <code>app_act</code>,{' '}
                  <code>app_events</code>, discovery — works with any MCP client.
                </p>
                <span className="url">packages/mcp →</span>
              </a>
              <a className="card" href={`${REPO}/tree/main/packages/cli`}>
                <h3>Agent CLI</h3>
                <p>
                  State-driven command line: open pages, run actions, watch diffs — scripts and
                  humans welcome.
                </p>
                <span className="url">packages/cli →</span>
              </a>
              <a className="card" href={`${REPO}/tree/main/packages/client`}>
                <h3>TypeScript client</h3>
                <p>
                  Hydration, navigation, version negotiation, auth duty cycle — build your own agent
                  on it.
                </p>
                <span className="url">packages/client →</span>
              </a>
            </div>
          </div>
        </section>

        <section id="adopt">
          <div className="w">
            <p className="kicker">Adopt</p>
            <h2>Migrate your site with an agent</h2>
            <p className="sdesc">
              Copy the prompt, paste it into your coding agent (Cursor, Copilot, Claude Code,
              Devin). It asks one question — full migration or canonical + auto-negotiation — pulls
              the live schema, then walks the matching guide.
            </p>
            <div className="ctas">
              <CopyBtn code={ADOPT_PROMPT}>copy the adoption prompt →</CopyBtn>
              <a className="btn btn-sec" href={`${REPO}/blob/main/docs/adopt-prompt.md`}>
                view prompt source
              </a>
            </div>
            <div className="grid" style={{ marginTop: 14 }}>
              <a className="card" href={`${REPO}/blob/main/docs/canonicalmigration.md`}>
                <h3>Canonical + negotiation</h3>
                <p>
                  Keep the DOM for humans; serve manifests on the same URLs via <code>Accept</code>.
                  The default path for existing sites.
                </p>
                <span className="url">docs/canonicalmigration.md →</span>
              </a>
              <a className="card" href={`${REPO}/blob/main/docs/fullmigration.md`}>
                <h3>Full migration</h3>
                <p>
                  Manifests become the page documents — HTML a thin fallback or gone. For
                  agent-first surfaces.
                </p>
                <span className="url">docs/fullmigration.md →</span>
              </a>
            </div>
          </div>
        </section>

        <section id="benefits">
          <div className="w">
            <p className="kicker">Why</p>
            <h2>What a manifest buys you</h2>
            <p className="sdesc">Over a DOM.</p>
            <div className="grid">
              {BENEFITS.map(([h, p]) => (
                <div className="card nolink" key={h}>
                  <h3>{h}</h3>
                  <p>{p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features">
          <div className="w">
            <p className="kicker">Features</p>
            <h2>Protocol surface</h2>
            <p className="sdesc">
              Everything below is implemented and conformance-tested in this repo.
            </p>
            <div className="grid">
              {FEATURES.map(([h, p]) => (
                <div className="card nolink" key={h}>
                  <h3>{h}</h3>
                  <p>{p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="benchmarks">
          <div className="w">
            <p className="kicker">Benchmarks</p>
            <h2>Measured, not claimed</h2>
            <p className="sdesc">
              Same flight-booking content in both representations — reproduce with{' '}
              <code>node benchmarks/run.mjs</code>. Measured run: 2026-09-26, localhost, Node 24.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>HTML / DOM</th>
                    <th>APP</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {BENCHES.map(([m, h, a, n]) => (
                    <tr key={m}>
                      <td>{m}</td>
                      <td>{h}</td>
                      <td className="a">{a}</td>
                      <td>{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine">
              Methodology + runner: <a href={`${REPO}/tree/main/benchmarks`}>benchmarks/</a>.
              Production sites skew further in APP&apos;s favor (100 KB–2 MB pages, heavier JS).
            </p>
          </div>
        </section>

        <section id="schemas">
          <div className="w">
            <p className="kicker">Schemas</p>
            <h2>Manifest schemas</h2>
            <p className="sdesc">
              JSON Schema (draft 2020-12) for every wire document — enforced by the test suite.
            </p>
            <div className="pill-list">
              {SCHEMAS.map(([name, href]) => (
                <a className="pill" href={href} key={name}>
                  <code>{name.split(' — ')[0]}</code>
                  {name.includes(' — ') ? ` ${name.split(' — ')[1]}` : ''}
                </a>
              ))}
            </div>
            <div className="stack" style={{ marginTop: 18 }}>
              <CopyBlock
                label="a page manifest — what GET returns"
                code={`{"app":"1.1",
 "page":{"id":"app_home","url":"...","title":"Agent Page Protocol","version":"app-landing-1"},
 "state":{"headline":{"type":"string","value":"Web pages as JSON manifests…"}, …},
 "actions":{"ingest_manifest":{"kind":"navigate","side_effect":"safe",…}},
 "present":{"layout":"detail","sections":[…]}}`}
              />
            </div>
          </div>
        </section>

        <section id="demos">
          <div className="w">
            <p className="kicker">Demos</p>
            <h2>Live on real domains</h2>
            <p className="sdesc">
              Real middleware, real protocol. Open with the extension — or fetch the manifest
              directly.
            </p>
            <div className="grid">
              {DEMOS.map(([h, p, href]) => (
                <a className="card" href={href} key={href}>
                  <h3>{h}</h3>
                  <p>{p}</p>
                  <span className="url">{href.replace('https://', '')}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section id="how">
          <div className="w">
            <p className="kicker">Mechanics</p>
            <h2>How it works</h2>
            <div className="steps">
              <div className="card step nolink">
                <span className="n">1</span>
                <h3>Serve a manifest</h3>
                <p>
                  Express middleware turns your routes into typed JSON pages with declared actions.
                </p>
              </div>
              <div className="card step nolink">
                <span className="n">2</span>
                <h3>Two readers</h3>
                <p>
                  Agents read the JSON; the extension renders the same document as a human site.
                </p>
              </div>
              <div className="card step nolink">
                <span className="n">3</span>
                <h3>Actions, not clicks</h3>
                <p>Agents POST typed action requests; servers answer with manifests or diffs.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="w">
          <p>
            <a href={REPO}>Source</a> · <a href={`${REPO}/tree/main/docs`}>Docs</a> ·{' '}
            <a href={`${REPO}/tree/main/schema`}>Schemas</a> ·{' '}
            <a href={`${REPO}/tree/main/benchmarks`}>Benchmarks</a> ·{' '}
            <a href="/.well-known/agent-page">/.well-known/agent-page</a> ·{' '}
            <a href="/manifest.app.json">manifest.app.json</a>
          </p>
          <p className="fine">
            This page is the human edition of an APP document. Agents: ingest the same URL with{' '}
            <code>Accept: application/vnd.agent-page+json</code>.
          </p>
        </div>
      </footer>
    </>
  );
}
