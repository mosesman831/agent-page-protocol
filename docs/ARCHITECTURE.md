# Architecture

Agent Page Protocol (APP): a JSON wire format that replaces HTML/DOM for agent-driven
browsing. Servers return **page manifests** (`application/vnd.agent-page+json`); clients
execute **actions** and receive **diff documents** (RFC 6902 JSON Patch) to apply locally.
This repository holds the protocol's implementation _and_ its specification — the spec
documents under `docs/specs/` are tracked IP — they live in the private repo `mosesman831/APP-specs` and are cloned into `docs/specs/` locally (gitignored here).

## Layout

| Path                             | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/server`                | Express middleware: content negotiation, manifest validation, action dispatch, idempotency, CSRF, confirmation/challenge flow (§6.6 validation order).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/client`                | `AgentClient`: hydrate/navigate/invoke, navigation stack, diff application, auth refresh, policy redaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/tool-core`             | Tool runtime wrapping `AgentClient` + credential store; the seam automation tools bind to.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/cli`                   | `agent-page` CLI (`open`, `act`, `watch`, capability discovery) over tool-core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/mcp`                   | MCP server exposing the tools to MCP-capable agents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/conformance`           | The TV-01..TV-142 conformance suite: in-process Express server (`src/server/`), vector runners (`src/vectors/runs/`), shared builders (`src/server/fixtures.ts`), plus the wire-format equivalence test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `extension/`                     | Chrome MV3 extension (plain JS): `protocol/` wire-format impl, `renderer/` DOM renderer, `ui/` modals, `background/service-worker.js`, `.harness/` the puppeteer assertion harness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `schema/`                        | JSON Schemas (draft 2020-12) for manifest/diff/action/state/present/etc. `validate-schemas.mjs` parses them; `check-documents.mjs` Ajv-validates every demo manifest + generated harness fixture (both run via `npm run test:schema` inside `npm test`). `demo/` holds three manifest demo sites (British Airways booking, HotelHub, Classroom) served by `demo/serve.mjs` (`npm run demo`), which mounts the real `@agent-page/server` middleware (`demo/full-server.mjs`) over all sites including `protocol-lab/` — one page per protocol feature. `npm run test:features` e2e-sweeps every feature through the MCP server (fixed + dynamic tool modes) and the CLI binary; see `demo/FEATURES.md` for the coverage matrix. |
| `examples/flights`               | Reference storefront (login → shop → order → pay), incl. the 12 `node:test` payment-seam vectors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `docs/specs/`                    | Tracked protocol specs (SPEC.md is the contract of record) — private repo `mosesman831/APP-specs`, cloned in locally.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/prompts/`, `docs/archive/` | Design prompt history + spec-generation tooling — private repo `mosesman831/APP-specs` (under `prompts/`/`archive/`), not in this repo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `benchmarks/`                    | Wire-size benchmarks vs HTML/DOM.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PROGRESS.md`                    | Stage log for the production-readiness program.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Build, test, lint

```sh
npm ci
npm run build          # tsc for every buildable workspace (incl. conformance)
npm test               # all vitest workspaces + example-flights build
                       # + node --test payment-seam vectors + extension harness
npm run gen:fixtures   # regenerate extension/.harness/fixtures/*.json from
                       #   @agent-page/conformance builders (source of truth;
                       #   --check runs inside npm test and fails on drift)
npm run test:schema    # schema/*.json parse + document validation + the
                       #   oracle suites below (12 node:test files)
npm run demo           # manifest demo server at http://127.0.0.1:8788
npm run test:demo      # every demo page through the JS+TS validators
npm run lint           # eslint . + prettier --check .
npm run format         # prettier --write .
```

The extension harness (`extension/.harness/run-node.mjs`) serves the harness over
`node:http`, drives real Chromium via puppeteer, and runs 16 scenario passes
(7 vectors × document/shadow + reduced-motion variants, ~221 assertions). Puppeteer is
a devDependency; the CI/local environment needs a Chromium binary (puppeteer's cache or
`PUPPETEER_EXECUTABLE_PATH`).

## The schema oracle layer (`npm run test:schema`)

`schema/` holds two things beyond the JSON Schemas: a **wire corpus**
(`corpus.mjs` boots the real middleware + CLI and captures every document
type as actually emitted — manifests, action-requests, diffs, error
envelopes, event records, logical values, and the CLI's tool/* artifacts)
and a set of **oracles** — each suite pins a different invariant:

| Suite                       | Invariant                                                                      |
| --------------------------- | ------------------------------------------------------------------------------ |
| `documents.test.mjs`        | every manifest + wire doc validates against its schema                         |
| `parity.test.mjs`           | generated harness fixtures can't drift from conformance builders               |
| `fuzz.test.mjs`             | schema-invalid mutants → strict client rejects (lenient tolerance recorded)    |
| `projection.test.mjs`       | every corpus manifest downlevels to a schema-valid 1.0 doc, idempotently       |
| `emit.test.mjs`             | emit validators reject every schema-invalid mutant (validator level)           |
| `emit-wire.test.mjs`        | same mutants through the real middleware → never a 200 carrying invalid        |
| `conformance-emit.test.mjs` | every conformance-server route emits schema-valid manifests (pinned negatives) |
| `request-fuzz.test.mjs`     | `validateActionRequest` rejects invalid requests incl. catalog rules           |
| `request-wire.test.mjs`     | mutated requests over real HTTP → structured envelopes (never 200/500/hang)    |
| `diff.test.mjs`             | wire diffs apply cleanly; malformed diffs reject `app.err.diff.*`              |
| `event-fuzz.test.mjs`       | `validateEventRecord` (wired into `MemoryEventStore.append`)                   |
| `extension-fuzz.test.mjs`   | the extension's lenient validator never throws on mutants                      |

Shared mutations live in `schema/mutations.mjs`; the emit validators
(`validatePageBlock`/`validateStateRoot`/`validateManifestActions`/
`validateNavigation`/`validatePresent`/`validateMeta`/`validateEventRecord`)
mirror `schema/*.json` invariants the wire can't re-check.

## Wire format: two implementations, one proof

Two independent implementations of the wire format exist deliberately — the extension is
plain JavaScript (MV3, no build step), the packages are TypeScript:

- TS: `@agent-page/client` (`isPageManifest`, `isDiffDocument`, `applyDiffDocument`,
  `parseMediaType`) and `@agent-page/server` (`validateStateRoot`, deep rules).
- JS: `extension/protocol/{parse,validate,diff}.js` (`classifyDocument`,
  `parseMediaType`, `validateManifest`, `validateAppDocument`, `validateDiffDocument`,
  `applyDiffDocument`).

`packages/conformance/test/extension-equivalence.test.ts` runs every conformance vector
through the real server, captures all wire documents, and asserts both implementations
classify, validate, and apply diffs identically (plus synthetic edge docs for `app:"1.1"`
and unknown types). Divergence is a test failure — the JS implementation may never drift
from the spec that the TS suite enforces.

Money/currency formatting exists exactly once in the extension: `extension/protocol/money.js`
(the only file containing `Intl.NumberFormat`). All renderers and the harness import it.

## File-size budget

No file exceeds **800 lines**, except the following — each is kept whole deliberately,
with its testability story stated. Generated/binary assets (`.harness/shots/*.png`,
`package-lock.json`, `dist/`) are not line-based source and are exempt.

| File                                          | Lines       | Why it cannot be split                                                                                                                                                                                                             | How it stays testable                                                                                                         |
| --------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/conformance/src/server/v11.ts`      | ~2450       | Flat Express route table for the v11 vectors; every handler closes over the single `state` map + helpers built once per server. Splitting forces exporting shared mutable state (import-cycle risk) for zero isolation gain.       | Each route is exercised end-to-end by its TV-xx vector; `extension-equivalence.test.ts` additionally drives the whole table.  |
| `docs/specs/*.md` (4 files)                   | 1,900–3,800 | The spec documents of record — numbered sections cross-reference internally; a spec is one continuous document.                                                                                                                    | They are conformance inputs: vectors cite section numbers.                                                                    |
| `packages/cli/src/core/runtime.ts`            | ~1660       | One cohesive `createRuntime` assembly: client → store → dispatcher → capabilities. Splitting is arbitrary slicing of sequential construction sharing locals.                                                                       | `test/*.test.ts` exercises the runtime through the CLI surface; capabilities covered by tool-core tests.                      |
| `packages/server/src/middleware.ts`           | ~1420       | The §6.6 ordered validation pipeline (size→CSRF→auth→action→authz→idempotency→version→confirmation→params→dispatch). Stages share `Request`/`Response` locals; splitting obscures ordering — the thing the file exists to enforce. | 113 server tests hit the pipeline through Express requests (incl. validation-order negative cases).                           |
| `extension/renderer/render-root.js`           | ~1285       | The renderer orchestrator: mount/diff/re-render over one ShadowRoot/document body. Splitting moves hidden state (live DOM refs, prev-manifest) across module boundaries.                                                           | The puppeteer harness asserts rendered DOM per vector incl. shadow + reduced-motion paths.                                    |
| `packages/tool-core/src/runtime.ts`           | ~1335       | Same ToolRuntime shape as cli: one assembly shared by the MCP server and CLI; a split duplicates the seam both consumers depend on.                                                                                                | 49 tool-core tests cover holds, credentials, envelopes, watch-poll.                                                           |
| `packages/client/test/agent.test.ts`          | ~1055       | An integration suite with a shared fetch-fixture harness; vitest files are independent — splitting adds files, not isolation.                                                                                                      | It _is_ the test.                                                                                                             |
| `packages/conformance/src/server/fixtures.ts` | ~1049       | Flat builder library for TV-01..60 page fixtures; builders share types but no state — any grouping is arbitrary.                                                                                                                   | Consumed by the vectors, by `server/v11.ts`, and by `extension/.harness/generate-fixtures.mjs` (drift-checked in `npm test`). |
| `extension/assets/styles.css`                 | ~1120       | One MV3 stylesheet loaded atomically by the extension; splitting adds load ordering risk for no testability gain.                                                                                                                  | The V-SKIN-C contrast assertions and layout checks in the harness cover it.                                                   |
| `extension/background/service-worker.js`      | ~990        | MV3 service worker: listener registration order matters and must be visible in one scope; splitting hides registration sequencing.                                                                                                 | Covered by the harness end-to-end (extension loaded in real Chromium).                                                        |
| `packages/client/src/actions.ts`              | ~940        | The action vocabulary table — name→method→idempotency→confirmation mapping; a flat registry read top-to-bottom.                                                                                                                    | Exercised by `agent.test.ts` and conformance action vectors.                                                                  |

The previously-oversized `runs/index.ts` and `runs/v11.ts` were split mechanically
(`v10-early/late`, `v11-shared/early/mid/late` behind unchanged `index.ts`/`v11.js`
barrels) — import sites did not move.

## Runtime dependencies

Every runtime dependency, and why no existing dep could do its job:

| Dep               | Where               | Why                                                                                                                          |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `express`         | server, conformance | HTTP framework the middleware/harness are written against.                                                                   |
| `fast-json-patch` | server, client      | RFC 6902 diff apply — the protocol's diff documents _are_ JSON Patch; a second patch impl would be a second source of truth. |

Everything else is devDependencies (typescript, vitest, eslint, prettier, puppeteer,
ajv + ajv-formats — the last two only for `schema/check-documents.mjs` document
validation; ajv6 ships transitively via eslint but predates draft 2020-12) —
test/tooling only, never shipped to a runtime.
