# Agent Page Protocol

Agent-first web browsing protocol. Structured JSON page manifests replace HTML/DOM as the canonical page representation. A Chrome extension renders manifests for humans.

Two audiences, one source of truth.

## Status

Draft **v0.5** (wire 1.0 + 1.1) - specification, reference implementation, and agent tool layer. 6 workspaces + Chrome MV3 extension; 442 vitest tests + 12 node:test payment-seam vectors + 221 extension assertions, all under `npm test` (conformance: 142 protocol vectors).

## Repository layout

| Path                                            | Description                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`docs/specs/`](docs/specs/)                    | Protocol specs — private repo `mosesman831/APP-specs`, cloned here locally (gitignored; not part of the public repo) |
| [`schema/`](schema/)                            | JSON Schema (`manifest`, `state-node`, `diff-document`, `action-request`, `error-envelope`, tool session schemas)    |
| [`packages/server`](packages/server/)           | `@agent-page/server` - Express middleware: negotiation, diffs, CSRF, idempotency, confirmation, async, well-known    |
| [`packages/client`](packages/client/)           | `@agent-page/client` - agent SDK: cache, hydrate, diff, policy, navigation, action dispatch                          |
| [`packages/conformance`](packages/conformance/) | `@agent-page/conformance` - 142 protocol vectors + auth/idempotency/confirmation/CSRF/events suites                  |
| [`packages/tool-core`](packages/tool-core/)     | `@agent-page/tool-core` - shared session store, digests, holds, credentials resolver                                 |
| [`packages/cli`](packages/cli/)                 | `@agent-page/cli` (`agent-page`) - stateful CLI: open, act, confirm, challenge, watch, discover                      |
| [`packages/mcp`](packages/mcp/)                 | `@agent-page/mcp` - MCP server: 10 fixed tools (`app_discover` ... `app_reset`)                                      |
| [`extension/`](extension/)                      | Chrome MV3 renderer (vanilla JS; load unpacked)                                                                      |
| [`examples/flights`](examples/flights/)         | Appendix D flight booking example (search → filter → book → pay)                                                     |

## Getting started

```bash
npm ci
npm run build
npm test
npm run lint
```

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for the workflow rules and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for structure, the wire-format
equivalence story, and the file-size budget.

### Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select [`extension/`](extension/)
4. Use the toolbar popup for per-origin Accept rewriting / Render APP toggles

### Flights example

```bash
npm run example:flights
# listens on http://localhost:3456
```

Happy path: `GET /flights` → search → results table → `filter` diff → `select_flight` → `confirm_booking` (428 challenge → confirmed diff).

## Media types

| Media type                               | Purpose        |
| ---------------------------------------- | -------------- |
| `application/vnd.agent-page+json`        | Page Manifest  |
| `application/vnd.agent-page-diff+json`   | Diff Document  |
| `application/vnd.agent-page-error+json`  | Error Envelope |
| `application/vnd.agent-page-action+json` | Action Request |

Key headers: `X-APP-Version`, `X-APP-Page-Id`, `X-APP-Response-Mode`, `X-APP-Client`, `X-APP-Idempotency-Key`, `X-APP-If-Match-Version`, `X-APP-Confirmation`, `X-APP-Origin`.

## Spec

See `docs/specs/SPEC.md` (private repo [mosesman831/APP-specs](https://github.com/mosesman831/APP-specs), cloned into `docs/specs/` — `git clone https://github.com/mosesman831/APP-specs.git docs/specs` — requires repo access) for the full protocol (wire format, security, extension architecture, conformance).
