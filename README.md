# Agent Page Protocol

**Structured web pages for agents — rendered as normal sites for humans.**

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Version: v0.5.0 public beta](https://img.shields.io/badge/version-0.5.0-orange.svg)
![Node: ≥18](https://img.shields.io/badge/node-%E2%89%A518-green.svg)

APP replaces HTML/DOM as the canonical page representation. A page is a JSON
manifest — typed state plus declared actions. Agents read and act on it
directly; the Chrome extension renders the same document as a real website.
One document, two readers.

**[agent-page-protocol.vercel.app](https://agent-page-protocol.vercel.app)** —
the launch page is itself an APP manifest (browsers get HTML, agents get JSON).

## Try it in 30 seconds

Every demo below speaks the wire today — no install required.

```bash
# Fetch a page manifest instead of HTML
curl -H 'Accept: application/vnd.agent-page+json' \
  https://demo-flight-app.vercel.app/app/mva/home

# Act on it — one typed POST instead of DOM scraping
curl -X POST 'https://demo-flight-app.vercel.app/app/mva/home' \
  -H 'Content-Type: application/vnd.agent-page-action+json' \
  -H 'Origin: https://demo-flight-app.vercel.app' \
  -H 'X-APP-Idempotency-Key: demo-42' \
  -d '{"app":"1.1","action":"search_flights",
       "params":{"from":"lhr","to":"jfk","depart":"2026-10-12"}}'
# → 303 to a results manifest with real flights
```

Actions return the next manifest or an RFC 6902 diff — ~89% fewer bytes than
re-fetching. Revalidation is an ETag → `304` round trip with a 0-byte body.

## Live demos

Each demo is one document with two readers — open the human site in a browser
(or with the extension), or fetch the agent manifest.

| Site                 | Human (generated DOM)                                                     | Agent (manifest)                                                        | What it exercises                                                                                                    |
| -------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Multiversal Airways  | [/site/mva/home](https://demo-flight-app.vercel.app/site/mva/home)        | [/app/mva/home](https://demo-flight-app.vercel.app/app/mva/home)        | Full airline: search → fare families → seats → extras → pay (confirmation + challenge) → manage → check-in → loyalty |
| Halvern House hotels | [/site/hotel/home](https://demo-hotel-app-eta.vercel.app/site/hotel/home) | [/app/hotel/home](https://demo-hotel-app-eta.vercel.app/app/hotel/home) | Search → rooms → checkout → confirmation → manage booking                                                            |
| Classwork            | [/site/gc/home](https://demo-classroom-app.vercel.app/site/gc/home)       | [/app/gc/home](https://demo-classroom-app.vercel.app/app/gc/home)       | Classroom: stream, classwork, grades, join-by-code, submissions                                                      |
| Protocol Lab         | [/site/lab/home](https://demo-lab-app.vercel.app/site/lab/home)           | [/app/lab/home](https://demo-lab-app.vercel.app/app/lab/home)           | Every wire feature: diffs, watch/SSE, async jobs, auth, delegation                                                   |

## Give your agent APP access

Paste [`docs/use-prompt.md`](docs/use-prompt.md) into a coding agent — it
points at [`docs/agent-setup.md`](docs/agent-setup.md), which walks through
installing the APP MCP server (10 fixed tools: `app_discover`, `app_open`,
`app_act`, `app_confirm`, `app_challenge`, `app_watch`, `app_sessions`,
`app_logout`, `app_reset`, `app_read`), the `agent-page` CLI, and the raw-HTTP
contract.

## Adopt APP — paste into a coding agent

Copy this prompt into Cursor, Copilot, Claude Code, Devin, etc. It asks one
question — full migration or canonical + auto-negotiation — fetches the live
schema from this repo, then follows the matching guide
([canonical](docs/canonicalmigration.md) / [full](docs/fullmigration.md)).
Same block on the [launch site](https://agent-page-protocol.vercel.app#adopt)
and in [`docs/adopt-prompt.md`](docs/adopt-prompt.md).

```text
You are an APP adoption agent. APP (Agent Page Protocol) replaces HTML/DOM as
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
            https://agent-page-protocol.vercel.app/app-extension.zip)
```

## Measured

From `benchmarks/run.mjs` against the flights server (2026-09-26, localhost,
Node 24 — reproduce with `node benchmarks/run.mjs`):

- ~100× smaller page transfer (3.3 KB manifest vs 328 KB HTML + assets)
- 7 round trips for a full booking flow vs 40+ DOM interactions
- 88.9% bytes saved on sequential updates (3.7 KB diffs vs 33.3 KB re-fetches)
- 0-byte cache revalidation; ~6.6 ms p50 end-to-end flow latency

## Repository layout

| Path                                            | Description                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`schema/`](schema/)                            | JSON Schema (`manifest`, `state-node`, `diff-document`, `action-request`, `error-envelope`, tool session schemas) |
| [`packages/server`](packages/server/)           | `@agent-page/server` — Express middleware: negotiation, diffs, CSRF, idempotency, confirmation, async, well-known |
| [`packages/client`](packages/client/)           | `@agent-page/client` — agent SDK: cache, hydrate, diff, policy, navigation, action dispatch                       |
| [`packages/conformance`](packages/conformance/) | `@agent-page/conformance` — 142 protocol vectors + auth/idempotency/confirmation/CSRF/events suites               |
| [`packages/tool-core`](packages/tool-core/)     | `@agent-page/tool-core` — shared session store, digests, holds, credentials resolver                              |
| [`packages/cli`](packages/cli/)                 | `@agent-page/cli` (`agent-page`, `apage`) — stateful CLI: open, act, confirm, challenge, watch, discover          |
| [`packages/mcp`](packages/mcp/)                 | `@agent-page/mcp` — MCP server: 10 fixed tools (`app_discover` … `app_reset`)                                     |
| [`extension/`](extension/)                      | Chrome MV3 renderer (vanilla JS; load unpacked)                                                                   |
| [`demo/`](demo/)                                | Four production-grade demo sites (airline, hotel, classroom, lab) — manifests + generated DOM                     |
| [`examples/flights`](examples/flights/)         | Minimal flight booking example (search → filter → book → pay)                                                     |
| [`benchmarks/`](benchmarks/)                    | Protocol performance suite                                                                                        |
| [`deploy/protocol-site`](deploy/protocol-site/) | The launch site (Next.js; APP manifest first, HTML fallback)                                                      |

## Getting started

```bash
npm ci
npm run build
npm test    # 21,369 tests: vitest + conformance vectors + extension harness
npm run lint
```

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for the workflow rules and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for structure, the wire-format
equivalence story, and the file-size budget.

### Chrome extension

Download [`app-extension.zip`](https://agent-page-protocol.vercel.app/app-extension.zip)
(or use [`extension/`](extension/) directly), then: unzip → `chrome://extensions`
→ **Developer mode** → **Load unpacked** → select `extension/`. Chrome Web
Store listing is coming with v1.0.

### Flights example

```bash
npm run example:flights
# listens on http://localhost:3456
```

Happy path: `GET /flights` → search → results table → `filter` diff →
`select_flight` → `confirm_booking` (428 challenge → confirmed diff).

## Media types

| Media type                               | Purpose        |
| ---------------------------------------- | -------------- |
| `application/vnd.agent-page+json`        | Page Manifest  |
| `application/vnd.agent-page-diff+json`   | Diff Document  |
| `application/vnd.agent-page-error+json`  | Error Envelope |
| `application/vnd.agent-page-action+json` | Action Request |

Key headers: `X-APP-Version`, `X-APP-Page-Id`, `X-APP-Response-Mode`,
`X-APP-Client`, `X-APP-Idempotency-Key`, `X-APP-If-Match-Version`,
`X-APP-Confirmation`, `X-APP-Origin`.

## Status

**v0.5 public beta.** The wire contract is stable and conformance-tested
(142 vectors); the beta window exists to collect real-agent feedback before the
v1.0 wire freeze. On the roadmap: Chrome Web Store listing, published npm
packages, Python SDK, manifest signing.

## License

[MIT](LICENSE) © 2026 mosesman831
