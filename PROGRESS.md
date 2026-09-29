# PROGRESS — APP-prod production-readiness

Work loop: one stage at a time, branch → change → exit gate (`npm run build && npm test && npm run lint`, all green) → merge to `main` → log here → next.
DONE conditions tracked per stage. Local repo: `/home/ubuntu/APP-prod`, remote: `github.com/mosesman831/APP-prod` (private).

Baseline (re-verified 2026-09-26, fresh clone): `npm ci && npm run build && npm test` → exit 0, **447 tests** (server 113, client 59, conformance 186, tool-core 49, cli 15+1skip, mcp 13, node:test payment-seam 12). ~45s.

---

## Stage 1 — Root declutter + ledger | `devin/stage1-declutter`

Commands:

```
git mv SPEC*.md CLIENT-TOOL-CONTRACT.md docs/specs/      # 7 files
git mv .devin-prompt-seam-build.md docs/prompts/seam-build.md
git mv patch_spec.py spec-parts docs/archive/          # nothing references them (grep-verified); archived, not deleted
sed updates: README.md, packages/server/README.md, extension/.harness/{harness.js,README.md}
```

What changed:

- Specs → `docs/specs/` (7 files), prompt files → `docs/prompts/`, `patch_spec.py` + `spec-parts/` → `docs/archive/`.
- `.gitignore`: `SPEC-*.md` / `.devin-prompt-*.md` narrowed to root-scoped (`/SPEC-*.md`, `/.devin-prompt-*.md`) so `docs/specs/` stays tracked — chose **fix the ignore rule** over `git add -f`.
- Added `LICENSE` (MIT — matches `package.json` `"license": "MIT"`; root file list requires it).
- Root now: `README.md`, `LICENSE`, `package.json`, `package-lock.json`, `.gitignore`, `PROGRESS.md` + source dirs only.

Exit gate: `npm run build` exit 0, `npm test` exit 0 (447 tests), `npm run lint` N/A (does not exist yet — Stage 2 adds it).

DONE items: **6 ✅** (root layout), **10 partial** (committed).

Next: Stage 2 — ESLint + Prettier across all workspaces + `extension/`, root `npm run lint` green.

---

## Stage 2 — Lint + format | `main` (process deviation: committed directly to main after gate passed; branch discipline restored from Stage 3)

Commands:

```
npm i -D -E eslint@10.11.0 prettier@3.9.7 typescript-eslint@8.70.1 eslint-config-prettier@10.1.8 globals@17.12.0 @eslint/js@10.0.1
# all published >7 days before install date (supply-chain rule); prettier pinned 3.9.7 not 3.9.9 (too new)
npx prettier --write .        # one-time whole-repo format: 230 files, +10783/-6513
npx eslint .                  # -> 28 errors -> fixed each (dead vars/init assignments/prefer-const/unused imports)
npm run lint                  # -> eslint . && prettier --check . -> exit 0 (1 warning: any in payment-seam.test.ts, warn-level not error)
```

What changed:

- `eslint.config.mjs` (flat): TS workspaces (`packages/`, `examples/`) get `js.configs.recommended` + `tseslint.configs.recommended` + prettier-compat; `extension/` gets js.configs.recommended + browser/serviceworker globals + `chrome`; `.mjs` scripts get node globals. `no-explicit-any` is `warn` (1 remaining warning in a test file — warning ≠ error, no disables).
- `.prettierrc.json`: `singleQuote, semi, tabWidth 2, printWidth 100, trailingComma all` — chosen to match existing style, minimal reformat.
- `package.json`: `"lint": "eslint . && prettier --check ."`, `"format": "prettier --write ."`.
- Real findings fixed (no disable comments added — verified `git diff | grep -c 'eslint-disable\|prettier-ignore'` = 0): dead unused vars/imports/params, dead initial assignments (`no-useless-assignment`), `prefer-const`, `no-loss-of-precision` literal → `Number.MAX_SAFE_INTEGER + 2` (same runtime value), `no-this-alias` → lexical `this` in arrow fn.
- One behavior-neutral removal: dead `buildLoginManifest` call in `examples/flights/src/pages/login.ts` `submit_otp` (result was discarded; `manifest` param now unused and removed).

Exit gate: `npm run build` exit 0, `npm test` exit 0 (447), `npm run lint` exit 0.

DONE items: **2 ✅**.

Next: Stage 3 — `npm test` runs extension assertions with generated fixtures.

---

## Stage 3 — extension assertions in `npm test` with generated fixtures | devin/stage3-harness

Commands + exit codes:

```
node extension/.harness/generate-fixtures.mjs --check   # fixtures: all generated files in sync -> exit 0
node extension/.harness/run-node.mjs                    # 16 runs -> harness: 221 passed, 0 failed -> exit 0
npm run build                                           # exit 0
npm test                                                # exit 0 (447 vitest/node tests + 221 harness assertions)
npm run lint                                            # exit 0 (0 errors, 1 pre-existing warn)
```

What changed:

- New `extension/.harness/generate-fixtures.mjs` — regenerates the five `.harness/fixtures/*.json`
  byte-for-byte. Fixtures are DERIVED, not hand-written: every StateNode leaf is built with the
  `@agent-page/conformance` node builders (`strNode`/`numNode`/`enumNode`/`boolNode`, the same
  machinery the 142 vectors use), page manifests assembled by the generator and serialized with a
  prettier-canonical emitter (inline-if-≤100-cols incl. `"key": ` prefix, `expandAlways` for the
  fixtures' always-expanded `present`/`sections` blocks). `--check` verifies no drift.
- New `extension/.harness/run-node.mjs` — node:http static server + puppeteer (bundled Chrome,
  `npm ci` postinstall) drives `index.html` for V-SKIN-1..6,V-SKIN-C × (document|shadow) plus the
  two reduced-motion runs = 16 runs, polls `#verdict`, exits non-zero on any FAIL. Replaces the
  chromium+`--dump-dom`+`python3 -m http.server` run.sh path for CI (`run.sh` kept for humans).
- `package.json`: `"gen:fixtures"`, `"test:extension"` (`gen:fixtures --check && run-node`),
  appended `&& npm run test:extension` to `"test"`; root `build` now includes `-w @agent-page/conformance`
  (the generator imports its `dist/` node builders — also makes `npm test` consistent).
- `eslint.config.mjs`: extension block narrowed to `*.js`; `.harness/*.mjs` drivers get node globals.
- New devDependency `puppeteer@25.11.0` (bundled Chrome; keeps fresh-clone zero-manual-steps —
  no system-chromium probing). justification lands in docs/ARCHITECTURE.md (Stage 7).

DONE items: **3 ✅** (extension assertions run under `npm test`; fixtures generated by
`npm run gen:fixtures` from conformance node builders — verified byte-identical, `--check` green,
221 assertions green).

Process note: fixture files remain committed (generator is the source of truth; `--check` enforces
sync). Derivation level documented honestly: fixtures share conformance's node-building machinery
but are demo-store pages, not the tv_* vectors themselves.

Next: Stage 4 — single money formatter in extension/.

---

## Stage 4 — single money formatter in extension/ | devin/stage4-money

Commands + exit codes:

```
grep -rn 'Intl.NumberFormat' extension/   # hits ONLY in extension/protocol/money.js -> OK
node extension/.harness/run-node.mjs      # harness: 221 passed, 0 failed -> exit 0
npm run build                             # exit 0
npm test                                  # exit 0 (447 + 221)
npm run lint                              # exit 0
```

What changed:

- New `extension/protocol/money.js` — the only file containing `Intl.NumberFormat`:
  `currencyFormatter(unit)` (cached), `formatCurrencyAmount`, `formatScaledMoney`,
  `formatScaledNumber`, `formatPlainNumber`, `formatCellCurrency`, `formatCellNumber`.
- `protocol/parse.js`: 4 call sites -> money.js (currency leaf, number+unit leaf, table-cell currency, table-cell number). File had no imports before; gains one money.js import.
- `renderer/render-root.js`: `formatTrackValue` fixed-decimal branch -> `formatScaledNumber`.
- `renderer/components/order.js`: local `formatMoney` deleted -> `formatScaledMoney as formatMoney` (same semantics incl. toFixed fallback).
- `renderer/components/commerce.js`: `resolvePrice` fixed-decimal branch -> `formatScaledNumber`; `resolveTableMoney` -> `currencyFormatter` + `formatScaledNumber` fallback.
- `.harness/harness.js`: `GBP` const -> `currencyFormatter('GBP')` (assertion expectations still computed by the same shared formatter).

DONE items: **4 ✅**.

Next: Stage 5 — wire-format equivalence test (packages/ TS vs extension/protocol JS over the same conformance vectors), or unify.

---

## Stage 5 — wire-format equivalence test | devin/stage5-equivalence

DONE 7 verdict: **(a) proven equivalent** — the same conformance vectors now run through both
implementations and assert identical verdicts.

Test: `packages/conformance/test/extension-equivalence.test.ts` (7 tests). It starts the
conformance server, runs ALL_VECTORS with a fetch wrapper capturing every wire document
(~120 docs incl. diffs + error envelopes), then compares:

- `classifyDocument` (extension/protocol/parse.js) vs `isPageManifest`/`isDiffDocument`
  (@agent-page/client) — same kind on every captured body + synthetic edge docs
- `validateManifest` (extension validate.js) vs `isPageManifest` + `validateManifestState`
  (@agent-page/server deep rules) — same verdict on every captured manifest
- `applyDiffDocument` (extension diff.js) vs `applyDiffDocument` (@agent-page/client) —
  same `ok`, deep-equal resulting manifest, same `changedPaths` + `navigation_effect`
- `parseMediaType` (parse.js vs client) — same on every captured Content-Type

Commands + exit codes:

```
npx vitest run test/extension-equivalence.test.ts   # 7 passed -> exit 0
npm run build && npm test && npm run lint           # all exit 0
```

Two REAL divergences found and fixed:

- `extension/protocol/parse.js` `classifyDocument` rejected `app: '1.1'` while
  `validateManifest` in the same package already accepted it and client `isAppVersion`
  accepts both — fixed classify to accept APP_VERSION_11 (spec: both versions supported).
- `packages/conformance/src/server/v11.ts` served `/pay/3ds-callback` with
  `page.id: '3ds_cb'` — violates `schema/manifest.json` `^[a-z][a-z0-9_-]{0,127}$`
  (SPEC error `app.err.manifest.invalid_page_id`). The JS validator correctly rejected
  it; the TS path didn't check the pattern. Fixed the fixture id to `pay_3ds_cb`.
  (Bug fix to match existing spec — not a protocol change; no new vectors needed.)

DONE items: **7 ✅**.

Next: Stage 6 — file-size cap ≤800 lines or ARCHITECTURE.md justification.

---

## Stage 6 — file-size budget ≤800 lines | devin/stage6-filesize

DONE 5 verdict: mixed — split the two mechanically-splittable offenders, justified the rest.

Splits (barrel re-exports — zero import-site changes):

- `runs/index.ts` 1191 → `v10-early.ts` (TV-05..39, 705) + `v10-late.ts` (TV-40..60, 501) +
  `index.ts` barrel (7 lines incl. `export * from './v11.js'`)
- `runs/v11.ts` 1675 → `v11-shared.ts` (wrap/discover11/postAction — discover11 stays
  re-exported for tool-core/cli), `v11-early.ts` (61-85), `v11-mid.ts` (86-110, carries
  `issueHold`), `v11-late.ts` (111-140); `v11.ts` barrel preserves `./runs/v11.js` imports.

Justified in docs/ARCHITECTURE.md (new — "File-size budget" table), 14 >800-line files
each with why-can't-split + testability: `conformance/src/server/v11.ts` (shared-state
route table, covered by vectors + equivalence), `cli|tool-core runtime.ts` (single
assembly), `server/middleware.ts` (§6.6 ordered pipeline), `render-root.js`
(shared live-DOM state), `service-worker.js` (listener registration order),
`styles.css`, `actions.ts`, `fixtures.ts`, `agent.test.ts`, the 4 spec docs; binary
shots/png + generated files exempt as non-line-based.

Commands + exit codes:

```
npx tsc -p packages/conformance --noEmit           # exit 0
npm run build && npm test && npm run lint          # all exit 0
find . -type f \( -name "*.ts" -o -name "*.js" -o -name "*.mjs" -o -name "*.css" -o -name "*.md" \) | xargs wc -l | awk '$1>800'
# -> 14 files, each with an ARCHITECTURE.md row (verified against the table)
```

Test count: 447 → **461** (186→193 conformance: +7 equivalence; totals: 113+59+193+49+15+1skip+13 vitest, 12 node:test, 221 extension assertions).

DONE items: 3 ✅, 4 ✅, **5 ✅**, 7 ✅.

Next: Stage 7 — docs/CONTRIBUTING.md + verify ARCHITECTURE.md is complete/accurate.

---

## Stage 7 — docs: ARCHITECTURE.md + CONTRIBUTING.md | devin/stage7-docs

DONE 8 verdict: both docs exist and are accurate.

- `docs/ARCHITECTURE.md` (written in Stage 6, expanded): layout table, build/test/lint
  commands, the two-impl wire-format story + the equivalence test, the file-size
  budget table (DONE 5), and the runtime-dependency rationale table.
- `docs/CONTRIBUTING.md` (new): setup (npm ci path, puppeteer/Chromium note), golden
  rules (vectors-first, never weaken tests, no new runtime dep without an
  ARCHITECTURE line, lint clean, root hygiene), branch/gate/merge workflow, the
  TV-vector recipe (spec -> route -> runner in the right v1x-* file -> register in
  `src/vectors/index.ts`), and the extension rules (generated fixtures, money.js).
- `README.md`: corrected test counts (442 vitest + 12 node:test + 221 extension
  assertions) and `npm install` -> `npm ci`; links to the two docs.

Commands + exit codes:

```
npm run build && npm test   # exit 0 (461 tests + 221 assertions)
npm run lint                # exit 0
```

DONE items: 3 ✅, 4 ✅, 5 ✅, 7 ✅, **8 ✅**.

Next: Stage 8 — fresh-clone verification (DONE 9) + FINAL VERIFICATION run.

---

## FINAL VERIFICATION — fresh clone, single uninterrupted run (2026-09-26)

Machine check: `git clone https://github.com/mosesman831/APP-prod.git /tmp/app-prod-fresh`,
then `npm ci && npm run build && npm test && npm run lint` — zero manual steps, all exit 0.

```
$ git clone https://github.com/mosesman831/APP-prod.git /tmp/app-prod-fresh
Cloning into '/tmp/app-prod-fresh'...

$ npm ci          # exit 0 (npm audit advisory notices only)
$ npm run build   # exit 0 (tsc: all 7 buildable workspaces incl. conformance)
$ npm test        # exit 0
    server        17 files  113 tests
    client         8 files   59 tests
    conformance   15 files  193 tests   (incl. extension-equivalence.test.ts 7 tests)
    tool-core     12 files   49 tests
    cli            5 files   15 tests (1 skipped)
    mcp            5 files   13 tests
    example-flights          12 node:test payment-seam vectors
    extension harness        "harness: 221 passed, 0 failed"
$ npm run lint    # exit 0
    eslint . && prettier --check .
    -> 1 warning (pre-existing no-explicit-any), 0 errors
    "All matched files use Prettier code style!"

$ ls -A   (root clutter check)
    .git .gitignore .prettierignore .prettierrc.json LICENSE PROGRESS.md README.md
    benchmarks docs eslint.config.mjs examples extension node_modules
    package-lock.json package.json packages schema

$ grep -rn "eslint-disable\|prettier-ignore" --include="*.ts" --include="*.js" --include="*.mjs" .
    (no matches)
```

DONE checklist — all 10 verified in this run (or directly evidenced above):

1. **>=447 tests, all green** ✅ — 442 vitest + 12 node:test + 221 extension assertions = 675.
   Count grew from baseline 447; nothing skipped/skipped-new (cli has the one
   pre-existing skip present at baseline). Zero `eslint-disable`/`prettier-ignore`.
2. **Lint+format configured everywhere** ✅ — flat eslint config covers all TS
   workspaces + `extension/**/*.js` + `.mjs` node files; prettier checks everything;
   exit 0.
3. **Extension assertions in npm test from generated fixtures** ✅ —
   `test:extension` = `npm run gen:fixtures -- --check` (drift check, printed
   "fixtures: all generated files in sync") + `node extension/.harness/run-node.mjs`
   (221 assertions, real Chromium). Generator: `extension/.harness/generate-fixtures.mjs`
   builds fixtures via `@agent-page/conformance` node builders.
4. **One money formatter** ✅ — `extension/protocol/money.js` is the only file in
   `extension/` containing `Intl.NumberFormat`.
5. **<=800 lines or justified** ✅ — two mechanical splits done
   (`runs/index.ts`, `runs/v11.ts` -> barrels + parts); remaining 14 >800 files each
   justified in `docs/ARCHITECTURE.md`.
6. **Clean root** ✅ — only allowed files + the lint config required by DONE 2
   (`.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`); specs in
   `docs/specs/`, prompts in `docs/prompts/`, `patch_spec.py`+`spec-parts/` in
   `docs/archive/`.
7. **Wire-format equivalence: option (a) proven** ✅ —
   `packages/conformance/test/extension-equivalence.test.ts` (7 tests): every wire
   document captured from all 140 vectors classified/validated/diff-applied
   identically by the TS and JS implementations, plus synthetic `app:"1.1"` and
   unknown-type edge cases. Found+fixed two real divergences (`classifyDocument`
   1.1 asymmetry; invalid `page.id` '3ds_cb' served by TV-123).
8. **Docs** ✅ — `docs/ARCHITECTURE.md` + `docs/CONTRIBUTING.md` accurate against
   this run (commands, counts, rules); README corrected.
9. **Fresh-machine check** ✅ — this section: clone -> npm ci -> build -> test ->
   lint, exit 0 end-to-end.
10. **Clean git state** ✅ — all work merged via `--no-ff` stage branches, imperative
    messages, nothing force-pushed; only uncommitted change at this moment is this
    PROGRESS.md entry itself (committed + pushed immediately after).

Status: **DONE.** All 10 conditions measurably true.

## Post-DONE — demo sites (follow-up task)

`demo/` — three example sites served as `application/vnd.agent-page+json` manifests and
rendered by the real extension renderer (no DOM/HTML from the sites):

- `demo/serve.mjs` — `node:http` demo server at `127.0.0.1:8788` (`npm run demo`).
- `demo/index.html` + `demo/viewer.js` — host shim + `AppRenderer` mount; hash routing.
- `demo/british-airways/` — full booking flow (search → outbound → return → fares →
  seats → passengers → pay → confirmation/PNR). Split `search.mjs` + `checkout.mjs`
  - `common.mjs` to stay under the 800-line cap.
- `demo/hotel-booking/` — search → results+filters → hotel → rooms → checkout → confirm.
- `demo/google-classroom/` — dashboard → stream → classwork → assignment → grades → people.
- `demo/lib/nodes.mjs` — manifest builders; `demo/validate.mjs` — every page run through
  `classifyDocument`, `validateManifest`, `isPageManifest`, `validateManifestState`.
- `npm run test:demo` wired into `npm test`; `demo/` added to eslint config (browser +
  node blocks). 20/20 manifests valid.

Gate output: `npm run build` ✓, `npm test` ✓ (113+59+193+49+15+13 vitest, 12 node:test,
221 harness assertions, 20 demo manifests), `npm run lint` ✓ (exit 0; 1 pre-existing
`no-explicit-any` warning in examples/flights test). Rendered pages verified in Chrome:
BA search form → results cards → seats table → payment (order + breakdown), hotel
results/checkout, Classroom stream.

Branch `devin/demo-sites` merged `--no-ff` into main and pushed.

## Post-DONE — proper manifest schema (follow-up task)

`schema/` was incomplete and broken: `manifest.json` $ref'd `present.json` and
`soft-error.json` (missing), `state-node.json` used `additionalProperties:false` inside
`nodeBase` in `allOf` — which rejects `value`/`options` on EVERY node, so no real
manifest could ever validate — and `action-def.json` required
`idempotent`/`timeout_ms` which are optional per SPEC §6.1/§7.

Changes:

- `schema/present.json` — new; models SPEC §13 (layout enum, theme, sections with
  columns/sortable/filterable/primary_action/item_key, component hint catalog incl.
  extension types order/geopoint/otp/consent, a11y, responsive breakpoints).
- `schema/soft-error.json` — new; SPEC §2.3.4 soft error object.
- `schema/state-node.json` — `nodeBase` `additionalProperties:false` replaced by
  `unevaluatedProperties:false` on each leaf (correct allOf composition).
- `schema/action-def.json` — `required` reduced to `["description","kind"]` (the only
  non-optional fields per SPEC/types.ts).
- `schema/check-documents.mjs` — Ajv 2020 + ajv-formats: registers all schema files by
  $id, compiles `page-manifest.json`, validates every demo manifest (20) + generated
  harness fixtures (4; extras.json skipped — intentionally malformed robustness
  fixture). Wired in as `npm run test:schema` inside `npm test`.
- DevDeps added: `ajv@8.17.1`, `ajv-formats@3.0.1` (node_modules only had ajv@6 via
  eslint, which can't compile draft 2020-12). Noted in docs/ARCHITECTURE.md.
- Found+fixed a real demo bug: `num(2, 'label')` spread a string into the node —
  schema caught it.

Gate: `npm run build` ✓ `npm test` ✓ (incl. test:schema: 21 schemas parse, 24 docs
valid) `npm run lint` ✓.

## Post-DONE — relative schema identifiers

The schema set used `https://agent-page.dev/schema/...` as every `$id`/`$ref` — a
domain that doesn't resolve; the URLs were identifier-URIs pretending to be real.
Nothing fetched them (Ajv resolves by registered $id; MCP `inputSchema` objects are
metadata), but the fake host was misleading.

Changes:

- `schema/*.json`: `$id` → bare filename (`"state-node.json"`,
  `"page-manifest.json"`); `$ref` → sibling filename. Tool schemas → `tool/<name>.json`.
- `packages/mcp/src/schemas.ts`: embedded `$id`s → `tool/envelope.json`,
  `tool/mcp/<tool>.in.json` (labels only — no network resolution).
- `docs/specs/*`: the same `$id`/`$ref` strings inside JSON-schema sketch blocks
  updated to match (`agent-page.dev` survives only in docs/archive/, which is
  historical material).

Gate: `npm run build` 0 / `npm test` 0 (test:schema: 21 schemas compile, 24 docs
valid — Ajv resolves relative $ids) / `npm run lint` 0.

## Stage 9 — MCP dispatch fix + live agent e2e ("test everything" prep)

- branch: `stage/agent-mcp-e2e` → `--no-ff` merge `d064d96`
- Found by actually driving the tools (this is what "test everything" was for):
  every fixed MCP tool was broken — `packages/mcp` dispatch/interface/mock used a
  stale positional runtime API while tool-core takes `(args)` objects; all calls
  failed at runtime while the suite stayed green on the same-broken mock.
- Fixed: `ToolRuntime` rewritten to arg-object API, `dispatchFixed` pass-through,
  `resources.ts`/`mock-runtime.ts` updated, new `test/real-runtime.test.ts`
  exercises the real tool-core runtime through `AgentPageMcpServer`.
- demo/serve.mjs: `/.well-known/agent-page`, `vnd.agent-page-error+json`
  envelopes, 428 confirmation challenges consumed via `X-APP-Confirmation`,
  action POSTs return the bare manifest with `vnd.agent-page+json`.
- demo/agent-run.mjs + demo/test-agent.mjs: an MCP stdio client books the full
  BA flow (discover → open → 8 actions → hold → confirm → PNR `T3KL9X` →
  sessions → logout) against an ephemeral demo server; `npm run test:agent` is
  part of `npm test`. Fresh `--home` per run (stale persisted sessions caused
  `app.err.tool.session_origin_mismatch` when the port changed).
- Exit gate: `npm run build` 0 | `npm test` 0 (14 mcp tests + agent e2e) | `npm run lint` 0.
- Next: GUI evidence — extension-rendered vs raw-JSON views; recorded agent run.

## Stage 10 — extension click-through + action_url fix

- branch: `stage/demo-action-url` → `--no-ff` merge
- Live extension run caught a real gap: `action()` never set `action_url`, so
  clients fell back to `page.url`. The extension's `pageState.url` stays on the
  last _fetch_ URL after in-place renders, so `select_outbound` POSTed to
  /app/ba/home → `app.err.action.unknown`. serve.mjs now defaults every action's
  `action_url` to the manifest's own `page.url` (the page that resolves it).
- Verified end-to-end in Chrome with the extension loaded: search → outbound →
  return → fare brands → seat map → passengers → payment → L4 confirm modal →
  Confirmed page, PNR `T3KL9X`, Payment Succeeded. Incognito (extensions off)
  shows the raw manifest JSON for the same URL — recorded both.
- Exit gate: `npm run test:agent` 0 after the fix (client posts to action_url).

## Stage 11 — recorded end-to-end proof ("test everything")

- Extension vs no extension recorded: incognito (extensions off) shows the raw
  manifest JSON; the normal window renders it. Full click-through captured:
  search → outbound → return → fares → seat map → passengers → payment → L4
  confirm modal → Confirmed (PNR T3KL9X).
- Agent via MCP recorded twice: (1) Devin driving `agent-page-mcp` over stdio
  JSON-RPC in a live terminal (full booking, hold → confirm → PNR T3KL9X);
  (2) independent Devin child session repeating the same flow on a fresh VM,
  choosing each call from the manifests (session 5aa03a36…6b, PNR T3KL9X).
- Follow-up fix found by the recordings: `stage/demo-confirm-modal-fix` —
  body_template `{param.x}` syntax + money-node `amount_path` (`total_due`,
  `add_bag_price`) so the modal interpolates and shows £1,397.00.
- All work merged `--no-ff` to main and pushed. Gate green throughout.

## Stage 12 — live extension UI sweep fixes + lab page hardening

- branch: `stage/protocol-lab-e2e` (continued)
- Live Chrome-extension sweep of protocol-lab found 7 real bugs; all fixed:
  1. Extension never sent `X-APP-Accept-Versions` → server projected every
     response to v1.0 (options_source/bulk/consent_purposes/resume_url
     stripped). Now sent on content-script GET+POST, service-worker POST,
     renderer GET (`1.0, 1.1`).
  2. Navigate actions unreachable: `fetch(redirect:'manual')` returns
     `opaqueredirect` (status 0, no Location) in extension contexts. Switched
     to `redirect:'follow'` + `res.redirected`/`res.url` (content-script +
     service-worker serializeActionResponse); dead 3xx/Location code removed.
  3. `pageState.version` not updated on diff responses → every subsequent
     action 409 (`requires_etag_match`). Now set from `X-APP-Result-Version`
     on `mode:'diff'`.
  4. SSE `hint:'diff'` event carried only `base_version`; a bad embedded diff
     crashed the renderer. full-server now sends the §14.1 full Diff Document
     ({base,result_version,diff}) + `base_version` mirror; renderer falls back
     to a revalidation GET when applyDiffLocal returns false.
  5. Form `array`/`object` params arrived as strings → `param_type` rejections
     (bulk_tag items[]). collectParams JSON-parses them (bad JSON stays a
     string so the server-side error still surfaces).
  6. L2 confirm modal/delegate sheet invisible: shadow-root overlays are
     siblings of `.app-shell`, outside the `:root,.app-shell` var scope —
     added both overlay classes to the theme-var selector.
  7. Consent component contract mismatch: emits `purposes=[{id,granted}]`;
     grant/revoke_consent handlers took string[] and wrote a `grants` map the
     component doesn't read. Handlers accept both shapes; lab + showcase
     consent state now uses the `purposes` array the component renders.
- Lab `present` blocks rewritten: sections use valid `state_path`/`label` +
  `layout:'form'`/`primary_action` per action (renderForm only binds the
  primary's inputs) via new `labPresent` helper; uitest-* probe pages deleted
  (shipped pages now expose every action). Showcase file node label moved to
  node level (inside `value` violates additionalProperties).
- Lab pages added to `schema/check-documents.mjs` corpus — the `state_paths`
  typo had never been validated; immediately caught 3 more schema violations
  (`async` flag on action-def, `results_path` as pointer not key, file-node
  label).
- runTypeahead `results_path` comment corrected (state key, per schema).
- Exit gate: `npm run build` 0 | `npm test` 0 (features sweep 30/30 MCP fixed,
  31/31 dynamic, 18/18 CLI; schema 37/37 docs incl. 13 lab pages) |
  `npm run lint` 0.
- Re-verification pass (testing agent, recorded) confirmed all 7 fixes live;
  found 4 more real bugs, fixed in this stage: 8. `/counter` wedge: `ensureEventSubscription` closed+reopened the EventSource
  on every refresh → server replayed the whole log → stale diffs →
  revalidate → resubscribe → replay, pinning all 6 per-origin sockets.
  Now reuses the live subscription for the same eventsUrl (reconnects carry
  Last-Event-ID) and EVENT_PUSH mirrors `diff.result_version`/`version`
  into `pageState.version` (SSE-applied bumps never reached the content
  script → next action's If-Match-Version was stale → 409 → the loop). 9. stale_base flash: SSE diff arrives before its own action response →
  response diff failed base check. applyDiffLocal now returns 'applied'
  for diffDoc.result_version === current version (echo = silent no-op).

10. Consent checkbox component POSTs `purposes:[{id,granted}]` — param
    item_type is now `{type:'object', properties:{id,granted}}` (was string);
    features-run.mjs sends objects.
11. `whoami`/`logout` 401 for the extension: login issued the session only in
    state.session_token (agent Bearer contract) — a browser client never got a
    credential. full-server now maps it to `Set-Cookie: session=<id>;
HttpOnly; SameSite=Strict` on POST /app/* responses.
12. Delegate post-confirm transport.network: `pay_external` returned a 303 to
    unreachable psp.example.com; the renderer already opens delegates_to for
    the human, so the POST now returns a diff binding the handoff in state.

- Cosmetic noted, not fixed: showcase object/array sections render raw JSON.
- Exit gate: `npm run build` 0 | `npm test` 0 (features 30/30, 31/31, 18/18;
  schema 37/37) | `npm run lint` 0.

## Stage 14 — per-document schema tests | stage/schema-per-file-tests

- `npm run test:schema` now runs `node --test schema/documents.test.mjs`:
  one test per manifest in the corpus (37 pass/fail cases, pytest-style).
  Shared validator + corpus live in schema/corpus.mjs.
- New `npm run schema:check -- <file.json>` validates arbitrary files
  against schema/page-manifest.json (exit 1 + per-error detail on failure).
- Verified: `npm run test:schema` → 37 pass; `schema:check package.json`
  fails listing missing required props; missing file → clean FAIL, exit 1.

## Stage 15 — live wire corpus vs every schema | stage/schema-wire-corpus

- `loadWireCorpus()` in schema/corpus.mjs captures REAL emitted documents:
  boots full-server (real middleware) + drives the real CLI (`--home`),
  then validates each wire document against its schema — action-request,
  diff-document, error-envelope, event, consent/challenge/features/session
  values (unwrapped from object StateNodes), hold, flow, and all 5
  tool/* CLI artifacts (index/session/hold-file/cache/config).
- `schema/documents.test.mjs`: 69 cases (37 manifests + 16 wire + 16
  negative — schemas must also REJECT invalid docs). `npm run test:schema`
  → pass 69, fail 0.
- Divergences the corpus caught and were fixed against the spec:
  1. challengeToObject dropped `channel`/`max_attempts` (SPEC §6) —
     ChallengeRecord now stores channel; both emitted.
  2. holdToObject omitted `status`/`who` (SPEC §7, who MUST be 'human') —
     HoldObject/holdToObject emit them.
  3. Long-poll /app-events body missed the `{app, event}` envelope.
  4. Lab consent state: numeric version, missing `required` flags —
     emits consent.json shape (str 'v1', required booleans).
  5. session.json additionalProperties:false forbade extension fields
     (flights emits email_masked) — relaxed; session state is extensible.
  6. tool/hold-file.json missed 5 fields the CLI writes
     (title/body/origin/pii_params/challenge_param) — added;
     challenge_param is nullable.
- Exit gate: `npm run build` 0 | `npm test` 0 (test:schema 69/69) |
  `npm run lint` 0.

## Stage 16 — semantic lint + v1.0 projection + embedded values | stage/schema-semantic-lint

- `schema/lint-manifest.mjs`: cross-field rules JSON Schema cannot express
  (present state_path/primary_action resolution, recoverable_actions ⊆
  actions, enum value ∈ options, secret:true on strings only, table row
  width, policy.*_params ⊆ input, options_source publish constraints,
  amount_path resolution, navigates_to/delegates_to exclusion, https-or-
  loopback URLs). `schema:check` runs it on manifests; 10 rules each
  proven by a negative case.
- `schema/corpus.mjs` also fetches lab pages under
  `X-APP-Accept-Versions:'1.0'`; documents.test.mjs asserts the
  projection emits `app:"1.0"` with zero 1.1-only state types, param
  types, or keys (§2.5).
- `schema/semantics.test.mjs` validates embedded logical values
  (state.consent/session/features, meta.flow) against their schemas
  wherever they appear — caught 3 live violations: lab home used
  spec-reserved `state.features` for a demo list (renamed
  `feature_index`); showcase's second consent node carried the pre-fix
  shape; generated order fixtures' `state.session` lacked `status`.
- Exit gate: `npm run build` 0 | `npm test` 0 (test:schema 128/128) |
  `npm run lint` 0.

## Stage 17 — §3.4.2 strictness + negotiated-version stamping | stage/middleware-must-fixes

Continued MUST-audit (task: walk every spec MUST/MUST NOT against code + vectors):

- `parseActionRequestBody` now rejects unknown action-request root keys
  with `400 app.err.payload.invalid_json` — §3.4.2 + schema/action-request.json
  allow only {app, action, params, client, context}. Previously `bogus:true`
  at the root was silently accepted.
- Version-stamping audit found systematic gaps: `diffForResponse` /
  `manifestForResponse` now stamp `app: negotiated version` (was a hardcoded
  '1.0' literal in `buildDiffDocument`, replay paths, async-202 manifest,
  navigate-201 body). Replay stores now persist the _sent_ representation —
  an idempotent replay under 1.0 previously could serve a doc whose body was
  projected but labelled inconsistently across paths.
- `decideEventSubscription` + demo `/app-events` + `/operations/:jobId` stamp
  negotiated version (appVersion input; default '1.1' where the transport
  has no negotiation, e.g. SSE re-open).
- New vectors TV-141 (unknown root key rejection) + TV-142 (diff.app ==
  negotiated; 1.0 diffs apply cleanly onto a v1.0-projected base via
  applyDiffDocument) — spec §27 entries + registry + fixtures + runs.
- Conformance suite now 144 vectors (142 TV + 2 aggregate tests); new
  middleware.test.ts cases cover root keys, diff/async/navigate stamping,
  replay fidelity.
- Exit gate: `npm run build` 0 | `npm test` 0 (144 vectors, schema 128/128) |
  `npm run lint` 0. Merged --no-ff cde1e13.

## Stage 18 — error-path conformance sweep | branch stage/error-path-sweep

- Commands: `npm run build` → 0 | `npm test` → 0 (152 vectors, schema 128/128,
  harness 221, MCP sweeps 30/30 + 31/31, CLI 18/18) | `npm run lint` → 0.
- Shared `body-parse.ts` (installAppBodyParsing/appBodyErrorCheck/
  appBodyErrorHandler) now serves create-app, conformance server, and demo —
  replaces 3 hand-duplicated express.json blocks; enforces §3.2 charset MUST
  (UTF-8 strict decode + BOM rejection → 400 app.err.payload.charset) and §3.4.2
  malformed JSON → 400 invalid_json; 413 → payload.too_large.
- `validate-manifest.ts`: publish-time MUST checks — action.too_many (>128) and
  options_source targeting an unknown action → options_source_invalid; wired
  into all 3 publish-validation sites via `validateStateRoot ?? validateManifestActions`.
- Two real protocol bugs fixed: (1) `projectErrorEnvelopeToV10` unconditionally
  rewrote `app` to '1.0', clobbering the highest-offered stamp on
  version.unsupported envelopes — sendError now only projects when a version was
  actually negotiated. (2) The 1.0 feature gate (challenge/bulk/1.1-param-types/
  options_source rejection) existed inside `validateActionRequest` but the
  middleware pipeline never called it — dead MUST; extracted to
  `checkV10FeatureGate`, now invoked before param validation.
- New vectors TV-143..TV-152: malformed JSON, BOM, invalid UTF-8, >64 KiB body,
  options_source_invalid, array_too_long, action not_found, version.unsupported
  stamp + version_mismatch via v= param, param_enum/param_pattern, 1.1
  geopoint under 1.0, internal.server envelope shape. Spec §27 + registry +
  fixtures + runs registered; vector count 152.
- Equivalence test: tsKind comparator now mirrors parse.js's version gate
  (app ∉ {1.0,1.1} → unknown) after TV-150's '9.9' stamp surfaced the drift.
- Exit gate green end-to-end; merge --no-ff to main, push.
- Next: continue audit tail — auth.session_invalid transitions, oauth_denied
  mapping, hold.invalid_widget, client-side catalog codes unit tests.

## Stage 19 — auth/consent/hold transition enforcement | branch stage/session-transitions

- Commands: `npm run build` → 0 | `npm test` → 0 (156 vectors; hold.test.ts 6/6;
  all sweeps green) | `npm run lint` → 0 (1 pre-existing warning in
  examples/flights/test/payment-seam.test.ts:33 — untouched).
- Library: `issueHold` now rejects `widgetUrl` that fails
  `isAllowedAppUrlScheme` (http allowed on loopback only) →
  `app.err.hold.invalid_widget` 500 — §7 publish/emission MUST; hold.test.ts
  unit covers bad/loopback/https.
- Conformance server: `/auth/google/callback?error=<idp>` →
  400 `auth.oauth_denied` (§4.9); `logout`/`logout_all` without an
  authenticated session (cookie/bearer/resume) → 409 `auth.session_invalid`
  (§5.1 transition table); `grant_consent` with an undeclared purpose →
  400 `consent.unknown_purpose` (§5.8, catalog = declared purposes object);
  `/v11/search` `q=badwidget` path emits a hold with an illegal widget_url and
  the emit check refuses with 500 `hold.invalid_widget` (§7).
- New vectors TV-153..156 in `runs/v11-edge.ts` (new file; v11-late.ts at
  800-line cap), spec §27 entries, registry, barrel export, counts 152→156.
- Gate green end-to-end; merge --no-ff, push.
- Next: client-side catalog codes (manifest._/discovery/navigation/diff.persist
  unit tests), events.mode unit tests, commerce._ (payment-seam), then the
  manifest semantic lint + v1.0 projection stages from the overnight plan.

## Stage 20 — client-side catalog codes + §5.7 receipt checks | branch devin/stage20-client-catalog-codes

- Commands: `npm run build` → 0 | `npm test` → 0 (client 72/72; full suite
  green) | `npm run lint` → 0 after prettier (1 pre-existing `any` warning
  examples/flights/test/payment-seam.test.ts:33 — untouched).
- hydrate.ts `validateManifest` now performs SPEC §5.7 receipt checks:
  page.id grammar `^[a-z][a-z0-9_-]{0,127}$` → `manifest.invalid_page_id`;
  page.url normalized equality vs effective request URL →
  `manifest.url_mismatch`; `strict` mode (AgentClient option, §5.7
  conformance-clients wording) rejects unknown root members →
  `manifest.strict_unknown` and unknown state node types →
  `state.unknown_type` (recursive object/array/table walk).
- Async Form D: `hydrate()` gained `expectedPageUrl` — /operations polls
  serve the page's own manifest under a different URL, so the identity
  check targets the originating page.url instead of the poll endpoint
  (agent.test.ts TV-50/51 uncovered this).
- actions.ts real bug: envelope-shaped 409 (`diff.conflict`/`action.conflict`)
  was rethrown inside the retry loop → the §7.4 rebase-and-retry block was
  unreachable and `diff.conflict_persistent` dead. Conflicts now `break`
  to the retry block; covered by both directions (retry-succeeds → 200,
  retry-conflicts → conflict_persistent).
- policy.ts `forbiddenKinds` option → `action.forbidden_kind`; consent.ts
  grant for undeclared purpose id → `consent.unknown_purpose`; events.ts
  bad `mode` string → `events.mode`. All previously catalog-only.
- New test/receipt.test.ts: 13 cases covering every emitter above plus
  cache.revalidate_failed (304 without cache entry).
- Gate green end-to-end; merge --no-ff, push.
- Next: audit tail — `discovery.link_missing` (extension-only, deferred per
  core-first steer), `commerce.*` payment-seam codes, then manifest semantic
  lint + v1.0↔v1.1 projection stages.

## Stage 21 — commerce.not_an_order + events.mode emitters | branch devin/stage21-order-guard-events-mode

- Commands: `npx vitest run` (server order.test.ts 11/11; conformance vectors
  159/159 incl. TV-157) → 0 | prettier clean | lint pending final gate.
- order.ts: `requireOrderValue(node)` — handler guard for untyped order
  state → 500 `commerce.not_an_order` (§12.2 catalog; previously declared
  only). Covers: non-node, wrong type, non-object value, missing id,
  unknown status.
- Conformance `/app-events`: `mode` param not in {sse,longpoll,long-poll}
  → 400 `app.err.events.mode` (§14; previously any unknown mode silently
  opened SSE).
- TV-157 in v11-edge.ts + vector file + registry + index + spec §27 +
  vectors.test.ts counts 156→157.
- Catalog sweep after stages 18–21: all 138 `app.err.*` registry codes now
  have a concrete emit site (node script verified — zero CATALOG-ONLY).
- Next: remaining spec-MUST audit tail is thin — feature-flag grammar,
  challenge bounds, hold semantics already enforced; moving to projection
  parity + any leftover discovery/link deferred to extension scope.

## Stage 22 — schema↔types parity + error registry parity | branch devin/stage22-schema-type-parity

- Commands: `npm run build` → 0 | `npm test` → 0 (schema suite 153: docs +
  semantics + parity; conformance parity 3/3; full suite green) |
  `npm run lint` → 0 (same 1 pre-existing warning).
- New `schema/parity.test.mjs` (node:test, TypeScript compiler API): every
  member of a wire-facing interface must be declared in the matching JSON
  schema, and every schema `required` field must exist in the type. Covers
  manifest/page/action-def/error-envelope+error/navigation/diff/event/
  challenge/hold/session/consent/flow-catalogEntry across BOTH
  client/src/types.ts and server/src/types.ts. `npm run test:schema` runs it.
- New `packages/conformance/test/error-registry-parity.test.ts`: shared
  codes must agree on httpStatus+retryable; asymmetric codes whitelisted
  explicitly (policy.denied client; too_many_params/rate.invalid_config
  server).
- Drift found and fixed: server registry `version.unsupported` 400→406
  (§2.4); client registry `state.invalid_node` 500→502 (SPEC table);
  action-def.json missing `async`; error-envelope.json missing `meta` +
  `error.confirmation_challenge`; client `ErrorEnvelope.meta`; both
  ChallengeObject +channel/max_attempts/mask/length/resend_*; HoldObject
  +status/who/resume_action/token (client parsers read them);
  server ConsentState +required; min_/max_length marked `@deprecated`
  (v1.1 uses `length`).
- Next: remaining audit items are protocol-behavior MUSTs — verifying
  §3.2 feature implication wiring on publish, challenge bounds clamps,
  idempotent-replay-under-hold (same-key same-body 428 during pending).

## Stage 23 — unstub conformance vectors | branch devin/stage23-unstub-vectors

- Commands: `npm run build` → 0 | `npm test` → 0 (vectors 159/159 incl.
  runVectors aggregate; schema suite 153) | `npm run lint` → 0 (same 1
  pre-existing warning).
- 7 stubbed vectors now run real assertions: TV-31 drives a real
  AgentClient against a `race_bump` fixture that conflicts even after a
  correct rebase → `app.err.diff.conflict_persistent`; TV-37 navigate
  action answered 200+manifest → client `manifest.invalid` (fixture
  `navigates_to` gained `{dest}` so the safe-GET shortcut doesn't bypass
  the POST path); TV-42 `/vectors/tv-42/a↔b` 303 loop → client aborts
  (redirect_loop/cycle); TV-48 rate-limit window now actually resets
  (windowed counter, 2 s) — vector waits Retry-After then asserts 200;
  TV-51 `/operations/:id` serves the terminal-failed doc for `fail_job`
  (async_failed + recoverable_actions + retry); TV-55 ManifestCache
  purgeOnLogout/epoch invalidation; TV-58 truncated-collection fixture
  asserts has_more + meta.truncated + paginate action.
- Still stubbed (documented, need APIs that don't exist): TV-56
  (client file-403 parent revalidation hook), TV-59 (extension message
  catalog — no extension host in the harness).
- Next: keep auditing residual MUSTs (challenge_nested budget,
  delegate resume_url preference, §13.4 rehydrate).

## Stage 24 — residual MUSTs: challenge budget + delegate resume_url | branch devin/stage24-residual-musts

- Commands: `npm run build` → 0 | `npm test` → 0 (client 79 incl. new
  challenge.test.ts 7/7; tool-core holds delegate round-trip; features-run
  32/32 incl. "delegate hold carries delegates_to + resume_url (K3 MF-9)";
  vectors 159/159; schema suite; harness 221) | `npm run lint` → 0 (same 1
  pre-existing warning).
- Client: `assertChallengeBudget` was effectively dead — the per-key
  challenge_invalid rule fired before the budget could bind, and the
  declared count was never passed. Now: factor steps are counted per
  `meta.flow.id` across sequential invokes (reset when `step_index === 1`
  signals a fresh flow) and `meta.flow.step_count` widens the budget up
  to MAX_FACTOR_STEPS=3; declared < 2 keeps the 2-step floor.
- Tools: `kind:"delegate"` holds now persist `delegate.url` =
  `delegates_to` (hand-off target) + `delegate.resume_url` = declared
  return URL falling back to page.url (K3 MF-9); surfaced via
  `publicHoldFromFile` in both tool-core and CLI (shared hold-file
  format); `schema/tool/hold-file.json` gained `delegate`.
- Deleted dead `resolveAsyncPoll` (handlers.ts) — /operations route owns
  async polling now.
- Next: 3-factor chain conformance vector (new fixture + TV row), or the
  remaining extension-host items.

## Stage 25 — TV-158 nested-challenge vector + 3-factor fixture | branch devin/stage-25-nested-challenge-vector

- Commands: `npm run build` exit 0; `npm test` exit 0 (160/160 in vectors.test.ts, all suites green); `npm run lint` exit 0 (prettier --write for 2 files).
- Changes: v11.ts /v11/login3fa[-tight] fixture — three sequential factor challenges (otp → totp → backup_code) chained on one meta.flow.id; state.ts V11Challenge kinds += totp/backup_code/magic_link + param; challengeNode uses challenge.param. TV-158 vector: declared meta.flow.step_count=3 completes the full chain to the account page; declared=2 aborts the third factor client-side with app.err.auth.challenge_nested (no third POST). Registry/test/spec §27: 157 → 158.
- DONE: conformance suite now exercises the §6/§1342 nested-challenge budget end-to-end against the wire, including the client-synthesized abort — the stage-24 behavior is pinned by a vector, not just a unit test.
- Next: close remaining honest stubs (TV-56 parent-revalidation hook, TV-59 extension catalog) or further adoption/core work.

## Stage 26 — Unstub TV-04/TV-56/TV-59; client downloadFile + pagination rules | branch devin/stage-26-unstub-tail

- Commands: `npm run build` exit 0; `npm test` exit 0 (160/160 vectors, client suite incl. new receipt case); `npm run lint` exit 0.
- Changes:
  - `packages/client/src/file.ts` (new): `downloadFile` — resolves file-node value, GETs the URL with `redirect:'manual'`, follows ≤1 same-origin redirect, on 401/403 revalidates the parent manifest (`hydrate(force,bypassCache)`) and retries once, verifies declared `sha256` → `app.err.state.invalid_file` on mismatch. Wired as `AgentClient.downloadFile` + `AppHttpClient.getFile`.
  - `packages/client/src/hydrate.ts`: `normalizePagination` — `cursor:null`+`has_more:true` → `has_more:false` and appends `app.warn.state.pagination_inconsistent` to `meta.warnings` (client-side enforcement; the conformance server already normalizes on emit).
  - conformance server: `/files/signed-fresh` returns `doc-ok-bytes`; tv-56's manifest advertises the expired URL on first GET and the fresh URL+sha256 on revalidation (`state.pageGets`).
  - TV-56 now drives `client.downloadFile` end-to-end (403 → revalidate → verified bytes); TV-59 imports `extension/protocol/messages.js` and asserts `isAppExtMessage` drops unknown types/versions/non-envelopes while `createMessage` refuses to build them; TV-04 drives `client.hydrate` and asserts normalized flag + warning; `receipt.test.ts` adds the client-side normalization unit test.
- DONE: zero stubs remain across all 158 vectors.
- Next: keep hardening core — remaining known gaps are adoption-facing (OAuth delegation, manifest signing, store listing), not core protocol.

## Stage 27 — fuzz parity oracle + strict-mode fixes | devin/stage-27-fuzz-parity

- Commands: `node --test schema/fuzz.test.mjs` → 1239 pass / 0 fail (exit 0);
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- New `schema/fuzz.test.mjs`: mutates every corpus doc (~40 docs → ~1200
  mutants) and runs schema validation vs real `AgentClient` strict hydrate as
  oracles. Tier A = §5.7 strict-contract surface → agreement asserted
  (845 cases). Tier B = below strict contract → schema must reject, client
  verdict recorded (242 tolerated, 0 rejected — stats only). Tier S =
  strict-only enforcement pinned: unknown root members stay schema-valid
  (forward-compat) while strict clients MUST reject.
- Fuzz caught two real strict-mode holes, fixed:
  `isPageManifest` accepted `state` arrays (added `!Array.isArray`);
  `checkStrictNodes` skipped nodes missing a string `type` (now
  `invalid_node`).
- DONE: core hardening (extra stage, post-final-verification). Next: stage 28
  picks from the remaining adoption-facing gaps or another core audit pass.

## Stage 28 — v1.1→v1.0 projection oracle | devin/stage-28-projection

- Commands: `node --test schema/projection.test.mjs` → 38 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- New `schema/projection.test.mjs` runs every corpus manifest through the real
  `projectManifestToV10` and asserts: result stays schema-valid stamped
  `app:'1.0'`; every 1.1-only construct is gone (node types
  geopoint/quantity/order/daterange/datetimerange, param types
  file/geopoint/date_range/datetime_range/quantity/money, options_source /
  transfer / accept_mime / bulk / consent_purposes / step_up / resume_url /
  page.focus / time_zone / navigation.anchors / error message_id+retry_class);
  integer+scale money survives; projection is idempotent; the projected doc
  hydrates under the strict AgentClient.
- Outcome: projector is clean across all 38 corpus manifests — no fixes needed.
- DONE: core hardening. Next: stage 29.

## Stage 29 — emit-validation oracle + emit-validator hardening | devin/stage-29-emit-oracle

- Commands: `node --test schema/emit.test.mjs` → 823 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- New `schema/emit.test.mjs`: every corpus manifest is mutated under /state and
  /actions; any schema-invalid mutation MUST also fail the server's emit-time
  validators (`validateStateRoot` + `validateManifestActions`) — a server must
  never emit what the schema forbids.
- Found and fixed real emit-validator gaps: node member strictness (§5.2#12)
  and forbidden member keys (§5.2#7) were unchecked server-side; pagination
  member strictness; `validateManifestActions` never looked at the defs —
  now checks id grammar, required description, kind/side_effect enums, and
  param type enums recursively; exported `validateManifestActions` +
  `MAX_ACTIONS_PER_PAGE` from @agent-page/server.
- Deliberately NOT rejected emit-side: pagination cursor:null+has_more:true —
  spec design tolerates it on the wire (client normalizes + warns; TV-04
  exists to exercise exactly that). Emit validation initially rejected it and
  broke TV-04; reverted per spec intent.
- DONE: core hardening. Next: stage 30.

## Stage 30 — emit coverage extended to page/navigation/present/meta | devin/stage-29-emit-oracle

- Commands: `node --test schema/emit.test.mjs` → 1147 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Emit validation previously only covered /state and /actions. Added
  `validatePageBlock` (member strictness + id/url/version/title/language
  grammars), `validateNavigation` (closed members, navItem label+url,
  anchors ≤32), `validatePresent` and `validateMeta` (object shape +
  forbidden keys anywhere inside). All wired into every emit path in
  middleware (getManifest, action full, action next).
- emit.test.mjs extended with block-level mutations; oracle rule unchanged:
  schema-invalid inside emit jurisdiction must fail emit validation.
- Fixed my own harness bug (again): `obj['__proto__'] = x` sets the
  prototype, not an own property — spread from `JSON.parse` instead.
- Regression-verified: all corpus docs still emit-clean; TV-04
  (deliberately inconsistent pagination) still serves.
- DONE: core hardening. Next: stage 31.

## Stage 31 — request-side fuzz oracle + client.kind validation | devin/stage-31-request-fuzz

- Commands: `node --test schema/request-fuzz.test.mjs` → 1077 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- New `schema/request-fuzz.test.mjs`: synthesizes a valid action request for
  each of 67 corpus actions (constraint-aware params: pattern/bounds-driven
  candidates picked via the real `validateParams`), then mutates through the
  real `validateActionRequest` — drop action, unknown/bad-pattern action ids,
  params array/scalar, extra root member, app=9.9, non-object body, bogus
  client.kind, 65+ params, illegal param names, missing required param,
  wrong-type param, missing/malformed idempotency key on sensitive actions.
- Caught one real validator gap: `client.kind` was copied through unchecked;
  `validateActionRequest` now enforces the kind enum.
- Deliberately accepted (spec-legal): `app='1.0'` under a 1.1 negotiation;
  extra `client`/`context` members (schema-open for forward-compat).
- DONE: core hardening. Next: stage 32.

## Stage 32 — emit-wire oracle (mutations through real middleware) | devin/stage-32-emit-wire

- Commands: `node --test schema/emit-wire.test.mjs` → 1146 pass / 0 fail;
  `node --test schema/emit.test.mjs` → 1147 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Shared mutation set extracted to `schema/mutations.mjs` (state, actions,
  page/navigation/present/meta blocks); emit.test.mjs now consumes it.
- New `schema/emit-wire.test.mjs`: boots the real `createAppServer` per
  corpus doc, swaps in each mutant via getManifest, and asserts the wire
  answers an error envelope — never a 200 carrying a schema-invalid
  manifest. Pins the middleware wiring itself, not just the validators.
- DONE: core hardening. Next: stage 33.

## Stage 33 — conformance-server emit oracle + TV-18 fixture fix | devin/stage-33-conf-emit

- Commands: `node --test schema/conformance-emit.test.mjs` → 44 pass / 0 fail
  (59 routes served, 42 schema-valid, 17 pinned non-200s);
  `npm test` exit 0; `npm run lint` exit 0.
- New `schema/conformance-emit.test.mjs`: boots the real conformance server,
  fetches every `tv-NN` route (+ known suffix variants), asserts every
  200-response is a schema-valid manifest, and asserts the non-200 set
  matches EXPECTED_NON_200 exactly (deliberate negatives the emit layer now
  intercepts, tv-42 redirects, tv-49 auth) — a newly failing route trips it.
- Found+fixed: tv-18's fixture emitted `present:{kind:'html',body:...}` —
  a member set no spec defines and the schema forbids; the route served
  200 + invalid doc before this stage's validators existed. Replaced with
  `present:{layout:'list'}` (the vector only tests `Accept: */*`).
- DONE: core hardening. Next: stage 34.

## Stage 34 — diff-apply oracle (wire diffs vs client) | devin/stage-34-diff-oracle

- Commands: `node --test schema/diff.test.mjs` → 13 pass / 0 fail;
  `npm test` exit 0; `npm run lint` exit 0.
- corpus.mjs now also captures `wire/page counter` (the diff's base doc), so
  it is schema-validated alongside the other wire docs AND feeds the oracle.
- New `schema/diff.test.mjs`: applies the real wire diff via client
  `applyDiffDocument` → result is schema-valid + emit-clean + version bumped;
  second apply fails `stale_base`; 9 malformed-diff mutations (bad base
  page_id/url/version, forbidden /page/* targets, **proto** traversal,
  unsupported op, move-prefix violation, outside-roots add) all reject with
  `app.err.diff.*` — no silent state corruption; empty-diff no-op verified.
- DONE: core hardening. Next: stage 35.

## Stage 35 — event emit validation + fuzz | devin/stage-35-event-emit

- Commands: `node --test schema/event-fuzz.test.mjs` → 24 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0
  (after `prettier --write PROGRESS.md` fixed a trailing-space nit).
- New `validateEventRecord` in `packages/server/src/events.ts` mirroring
  `schema/event.json` (required fields, type/hint enums, occurred_at
  date-time, member allowlist, forbidden-key walk) — wired into
  `MemoryEventStore.append` so malformed records never reach subscribers.
- New `schema/event-fuzz.test.mjs`: 18 schema-invalid mutants of the
  captured wire event all rejected; 3 legal additions accepted; append()
  throws `app.err.event.invalid`.
- DONE: core hardening. Next: stage 36.

## Stage 36 — extension-validator fuzz oracle | devin/stage-36-ext-fuzz

- Commands: `node --test schema/extension-fuzz.test.mjs` → 1185 pass / 0
  fail; `npm test` exit 0; `npm run lint` exit 0.
- New `schema/extension-fuzz.test.mjs`: replays the shared corpus mutations
  through the extension's parallel JS validator (`validateManifest`). The
  extension is the lenient client (§5.7), so the oracle pins its real
  contract: never throws, always returns a structured `{ok, code}` result,
  accepted docs still carry a manifest object, rejections carry
  `app.err.*` codes, and all schema-valid baselines still pass.
- Finding recorded (not a defect): extension tolerates ~390 schema-invalid
  mutants — chiefly navigation/present/meta member strictness and
  page.version grammar — consistent with lenient rendering; strict-mode
  enforcement lives in the TS client's `strict:true` hydrate.
- DONE: core hardening. Next: stage 37.

## Stage 37 — request-wire fuzz (mutated bodies over real HTTP) | devin/stage-37-request-wire

- Commands: `node --test schema/request-wire.test.mjs` → 24 pass / 0 fail;
  `npm test` exit 0; `npm run lint` exit 0.
- New `schema/request-wire.test.mjs`: sends mutated action requests to the
  live middleware. Adds the transport class validateActionRequest can't
  see — wrong Content-Type, malformed JSON, >64 KiB body (413), bare-array
  body — plus catalog-dependent rejections (unknown action/param, wrong
  param type) that pass the schema but must still 4xx. Every rejection
  returns a structured `{app, error.code}` envelope; legal requests
  (1.0-under-1.1, extra client/context members, good idempotency key)
  are never rejected as invalid.
- DONE: core hardening. Next: stage 38.

## Stage 38 — document the schema oracle layer in ARCHITECTURE.md | devin/stage-38-oracle-docs

- Commands: `npm test` exit 0; `npm run lint` exit 0 (docs-only stage).
- docs/ARCHITECTURE.md gains a "schema oracle layer" section: the wire
  corpus (what corpus.mjs captures), a table of all 12 suites and the
  invariant each pins, and where shared mutations + emit validators live.
- DONE: docs freshness. Next: stage 39.

## Stage 39 — widen action fuzz + param member allowlist | devin/stage-39-widen-actions

- Commands: `node --test schema/emit.test.mjs emit-wire extension-fuzz`
  → 4129 pass / 0 fail; `npm test` exit 0; `npm run lint` exit 0.
- `actionMutations` now fuzzes EVERY action per doc (was first 2) and adds
  param-def mutations: input.type bogus, unknown member (`secret` — legal
  only on state nodes per spec §11/D-12, never on ParamDef), item_type bogus.
- Found+fixed: `validateParamDef` had no member allowlist — invented members
  on param defs were schema-invalid (additionalProperties:false) yet passed
  emit validation. Added PARAM_MEMBERS (all 27 schema members) + forbidden-
  key check inside param defs.
- DONE: core hardening. Next: stage 40.

## Stage 40 — emit member allowlists for action defs, nav items, options_source | devin/stage-40-member-allowlists

- Commands: `node --test schema/{emit,emit-wire,extension-fuzz,fuzz}.test.mjs`
  → 5908 pass / 0 fail; `npm test` exit 0; `npm run lint` exit 0.
- Added ACTION_DEF_MEMBERS (16 schema members), NAV_ITEM_MEMBERS +
  NAV_ITEM_RELS + page_id grammar, and OPTIONS_SOURCE_MEMBERS to the emit
  validators — every closed-schema object type now has member strictness
  mirrored server-side (previously only page/nav/pagination/params had it).
- New mutations cover action-def extra members, nav-item extra member /
  rel enum / page_id grammar. Total oracle surface now ~5900 assertions
  across the 12 schema suites.
- DONE: core hardening. Next: stage 41.

## Stage 41 — emit↔schema drift oracle | devin/stage-41-drift-oracle

- Commands: `node --test schema/drift.test.mjs` → 5 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Emit validators mirror schema closed-member sets by hand — a maintenance
  hazard: schema adds a member, emit silently rejects it. Exported the
  allowlists (PAGE_MEMBERS, NAV_MEMBERS, NAV_ITEM_MEMBERS, NAV_ITEM_RELS,
  ACTION_DEF_MEMBERS, PARAM_MEMBERS, OPTIONS_SOURCE_MEMBERS, NODE_MEMBERS,
  PAGINATION_MEMBERS) and added `schema/drift.test.mjs`: for every closed
  object type (additionalProperties:false) the emit set must equal the
  schema property set; state-node members checked against the per-type
  union; event members probed through validateEventRecord.
- DONE: core hardening. Next: stage 42.

## Stage 42 — node-value semantics oracle | devin/stage-42-node-semantics

- Commands: `node --test schema/node-semantics.test.mjs` → 40 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Corpus mutations only exercise node types present in real manifests;
  `schema/node-semantics.test.mjs` builds synthetic docs for every node type
  and asserts schema/emit agreement — with emit legitimately stricter on
  semantics JSON Schema can't express (inverted dateranges, row-width ==
  fields-count, scale-vs-integer, option_labels key subsets).
- Found + fixed: `quantity` `unit` pattern `^[A-Za-z0-9_/%]+$` unenforced in
  emit; `enum.option_labels` keys not checked against `options` (dead-label
  data). Extended `stateMutations` with geopoint/order/table/enum/number/
  datetime/file value-level mutations — all caught by existing emit checks.
- DONE: core hardening. Next: stage 43.

## Stage 43 — deep present-block emit validation | devin/stage-43-present-validation

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- `validatePresent` only banned forbidden keys; the schema's closed internals
  (layout enum, 11-member sections, 26-type component catalog, columns/tabs/
  theme/a11y/breakpoints) were unchecked at emit — a schema-invalid present
  block could leave the wire and crash strict clients. Implemented full
  closed-member/enum/pattern checks; `meta` stays open per schema
  (`{"type":"object"}`). Present root corrected to closed
  (`additionalProperties:false` — the prior "schema-open" comment was wrong).
- Exported all present member/enum sets; drift.test.mjs pins them to
  present.json. Added section/component mutations to the shared oracle.
- Also learned: emit is legitimately stricter than the schema on
  cross-field invariants (enum value ∈ options, option_labels ⊆ options,
  daterange order, forbidden keys) — the wire oracle must assert rejection
  for schema-invalid only.
- DONE: core hardening. Next: stage 44.

## Stage 44 — generative manifest fuzzer | devin/stage-44-generative-fuzz

- Commands: `GENFUZZ_SEEDS=2000 node --test schema/generative.test.mjs` →
  2003 pass / 0 fail; `npm run build` exit 0; `npm test` exit 0;
  `npm run lint` exit 0.
- Mutational fuzz only explores INVALID docs. `schema/generator.mjs` is a
  seeded mulberry32 generator producing schema-valid manifests by
  construction — all 16 node types (incl. emit-strict semantics: enum
  value∈options, option_labels⊆options, daterange from≤to, table cells as
  plain values matching field types, closed member sets everywhere),
  actions+params, present sections/components, nav breadcrumb/related/
  anchors. `schema/generative.test.mjs` (GENFUZZ_SEEDS, default 120) asserts
  every generated doc is schema-valid AND emit-accepted AND strict-hydrates
  AND serves 200 on a real wire — a generated invalid doc is a generator
  bug, asserted as such with the seed for reproduction.
- Two generator bugs caught (file table-cells are objects not URL strings;
  nav members are breadcrumb/related/anchors not items/breadcrumbs).
- DONE: core hardening. Next: stage 45.

## Stage 45 — generative-mutant fuzz | devin/stage-45-generative-mutants

- Commands: `GENFUZZ_SEEDS=300 node --test
schema/generative-mutants.test.mjs` → 14,889 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Composes stages 32+44: the shared mutation library applied to GENERATED
  manifests — each random doc has different keys/shapes, so mutants hit far
  more invalid-document space than the fixed corpus (~50 mutants × seed).
  Every schema-invalid mutant must fail emit validation; emit-stricter cases
  (schema-valid, semantically invalid) are recorded not asserted.
- Harness fix on my side: `state ?? {}` silently absorbed the `state=null`
  mutant — pass `m.state` through like emit.test does.
- DONE: core hardening. Next: stage 46.

## Stage 46 — generative diff round-trip oracle | devin/stage-46-diff-generative

- Commands: `GENFUZZ_SEEDS=500 node --test
schema/diff-generative.test.mjs` → 501 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- `schema/diff-generative.test.mjs`: for each seed pair, generate two
  manifests sharing page identity → server `buildDiffDocument` →
  diff-document schema check → client `applyDiffDocument` must reconstruct
  `next` exactly (page.version via result_version) → applied doc re-validates
  - emit-clean → replay yields `app.err.diff.stale_base`. Diff correctness
    was previously pinned only by the counter fixture + malformed cases.
- DONE: core hardening. Next: stage 47.

## Stage 47 — projection over generated manifests | devin/stage-47-projection-gen

- Commands: `GENFUZZ_SEEDS=400 node --test schema/projection.test.mjs` →
  439 pass / 0 fail; `npm run build` exit 0; `npm test` exit 0;
  `npm run lint` exit 0.
- Refactored projection.test.mjs per-doc assertions into `checkProjection`
  and ran it over generated manifests — the generator emits the 1.1-only
  node types (geopoint/quantity/order/ranges) and param types the projection
  exists to strip, so random docs exercise it far wider than the corpus.
  500+ generated projections all: stamp app=1.0, stay schema-valid, drop
  every 1.1 member, keep 1.0 vocabulary, are idempotent, and strict-hydrate.
- DONE: core hardening. Next: stage 48.

## Stage 48 — lenient client + semantic lint over generated manifests | devin/stage-48-gen-lenient

- Commands: `GENFUZZ_SEEDS=300 node --test schema/semantics.test.mjs
schema/extension-fuzz.test.mjs` → 2608 pass / 0 fail; `npm run build`
  exit 0; `npm test` exit 0; `npm run lint` exit 0.
- extension-fuzz: every generated manifest accepted by the extension's
  lenient validateManifest. semantics: lintManifest produces zero errors on
  every generated doc — a false positive would mean the linter contradicts
  the schema (the generator only emits spec-conformant docs); checkLogical
  also re-validates embedded consent/session/features/flow values.
- DONE: core hardening. Next: stage 49.

## Stage 49 — generator coverage self-test | devin/stage-49-gen-coverage

- Commands: `node --test schema/generator-coverage.test.mjs` → 1 pass /
  0 fail; `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- New schema/generator-coverage.test.mjs: over ≥200 seeds, asserts the
  generator emits every schema vocabulary member — 16 node types,
  14 param types, 5 action kinds, 8 layouts, 26 component types — with the
  authoritative sets read from the schema JSONs themselves. Guards against
  an edit silently shrinking fuzz coverage (fuzzer self-bias).
- DONE: core hardening. Next: stage 50.

## Stage 50 — mutation coverage: all 16 node types | devin/stage-50-mut-cover

- Commands: `node --test schema/generative-mutants.test.mjs` → 3073 pass /
  0 fail; `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- mutations.mjs had type-targeted mutants for only 9 of 16 node types —
  boolean/null/date/array/quantity/daterange/datetimerange had none, so
  the invalid-space fuzz was blind to them. Added schema-invalid mutants
  for all seven (wrong value types, pattern/format violations, dropped
  required members, stray members); verified every new mutant is
  schema-invalid over 120 seeds.
- generative-mutants.test.mjs now pins the coverage: a seed sweep must
  produce at least one schema-invalid mutant per node type.
- DONE: core hardening. Next: stage 51.

## Stage 51 — error-catalog closure: every emitted code registered | devin/stage-51-err-catalog

- Commands: `node --test schema/drift.test.mjs` → 7 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Audit found 4 emitted `app.err.*` literals missing from the registries;
  unregistered codes fell back to httpStatus 500 via getErrorMeta. Two were
  wire-visible bugs: `app.err.action.invalid_def` and
  `app.err.action.invalid_id` are emit-time manifest-validation failures —
  they returned 500 where every sibling emit code (manifest.invalid,
  state.invalid_node) uses 502. Both registered at 502 on server + client;
  `app.err.event.invalid` registered 500 (internal event-store fault, never
  wire-bound); client-side `app.err.http_error` registered client-only.
- SPEC.md Appendix A gained the 3 rows; the conformance parity test's
  declared-asymmetry sets now list event.invalid (server) + http_error
  (client).
- drift.test.mjs gained the pin: every `app.err.*` literal in
  packages/{server,client,tool-core}/src must exist in some registry —
  emitted codes can never drift from the catalog again.
- DONE: core hardening. Next: stage 52.

## Stage 52 — warn-code drift pin | devin/stage-52-warn-drift

- Commands: `node --test schema/drift.test.mjs` → 7 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Follow-on to stage 51: `app.warn.*` literals have their own catalog
  (`WARN_CODES`, server). The drift test now checks every emitted
  `app.err.*`/`app.warn.*` literal against the right registry; all 12 warn
  codes verified already catalogued (incl. the client's
  state.pagination_inconsistent).
- DONE: core hardening. Next: stage 53.

## Stage 53 — boundary oracle + emit gap fix (state root key cap) | devin/stage-53-boundary

- Commands: `node --test schema/boundary.test.mjs` → 16 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- New schema/boundary.test.mjs exercises every hand-mirrored numeric limit
  at exactly N and N+1 — generative fuzz stays mid-range and mutants jump
  far outside, so the exact edge was untested. 12 state limits (enum
  options/option length/labels entries+length, table fields, state keys,
  file name, quantity unit, geopoint label, node unit, order items, array
  items) + 4 page limits (url/id/title/version).
- Real bug found at the boundary: manifest.json caps /state at
  maxProperties 512 but emit never checked the ROOT map — a 513-key state
  object was schema-invalid yet emit-accepted. Added the check to
  validateStateRoot (app.err.state.object_too_large, matching nested
  objects).
- Also fixed test:schema missing generator-coverage.test.mjs (stage 49's
  file never got wired into the script).
- DONE: core hardening. Next: stage 54.

## Stage 54 — emit-vs-schema divergence ratchet | devin/stage-54-divergence

- Commands: `GENFUZZ_SEEDS=200 node --test schema/generative-mutants.test.mjs`
  → 10,527 mutants, 0 divergences outside known classes; `npm run build`
  exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Emit is stricter than schema BY DESIGN — but previously unpinned: any new
  emit check could silently create a spec hole (a doc legal by the schema
  that no server can emit). Enumerated the full divergence space over 200
  generated seeds + the corpus: every schema-valid/emit-rejected case falls
  in a JSON-Schema-inexpressible class — sibling-member constraints (enum
  value ∈ options, option_labels keys ⊆ options, table row width,
  daterange from <= to), cross-field rules (quantity scale), or
  forbidden-key hardening (**proto**/constructor/prototype).
- Exported KNOWN_DIVERGENCE from schema/mutations.mjs and bound both emit
  sweeps (emit.test.mjs corpus + generative-mutants.test.mjs) so a NEW
  divergence class fails the suite instead of passing silently.
- DONE: core hardening. Next: stage 55.

## Stage 55 — diff-apply equivalence between strict client and extension | devin/stage-55-ext-diff

- Commands: `node --test schema/extension-diff.test.mjs` → 182 pass / 0
  fail; `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Real bug found: extension/protocol/diff.js applyDiffDocument only checked
  `base.version` — a diff pinned to another page (matching version string)
  applied cleanly. The strict client checks the full base identity triple
  (page_id, page_url via normalizeAppUrl, version). Fixed: ported
  normalizeAppUrl + urlsEqual into extension/protocol/diff.js (commented
  mirror of navigate.ts — the extension can't import the TS package) and
  added the page_id/page_url checks in the same order.
- New schema/extension-diff.test.mjs: same diff docs through BOTH
  implementations — generated pairs (assert verdict parity AND identical
  resulting manifests) plus 10 malformed-diff classes (assert both reject
  with the same code). First cross-impl test of the diff path; stage 5's
  equivalence only covered manifest validation.
- DONE: core hardening. Next: stage 56.

## Stage 56 — diff path-policy + URL-normalize equivalence | devin/stage-56-path-policy

- Commands: `node --test schema/extension-diff.test.mjs` → 184 pass / 0
  fail; `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Two more real extension bugs found by cross-impl comparison:
  - isAllowedDiffPath used raw `startsWith('/state')` — paths like
    `/stateX`, `/actionsX`, `/presentation`, `/metadata`, `/errors` were
    allowed (7 divergent paths). Rewrote it to mirror the client's
    exact-or-slash-prefix semantics with shared ALLOWED_DIFF_ROOTS /
    ALLOWED_DIFF_PAGE_FIELDS lists.
  - Extension never rejected table cell-level patches (client's
    isTableCellPath, TV-35). Ported the check; isAllowedDiffPath now takes
    an optional manifest param and applyDiffDocument passes it.
- Test grew: 45-path policy corpus (boundary roots, forbidden members,
  page fields, table cell vs whole-node) + 26-URL normalizeAppUrl
  equivalence suite (ports, case, dot-segments, percent-encoding, invalid).
- DONE: core hardening. Next: stage 57.

## Stage 57 — diff op-field mutation fuzz | devin/stage-57-op-fuzz

- Commands: `node --test schema/extension-diff.test.mjs` → 4,242 pass / 0
  fail; `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Two more real bugs found by op-mutation fuzz (15 field mutants × every
  op in 20 generated diffs, comparing strict client vs extension apply):
  - Strict client CRASHED with uncaught TypeError on a diff op missing
    `path` — isAllowedDiffPath did `path.startsWith` without a typeof
    guard. Added it (dist rebuilt).
  - Extension silently APPLIED add/replace/test ops missing `value`
    (wrote `undefined` into state); RFC 6902 requires it. Extension's
    validateDiffDocument now rejects missing `value`/`from`.
- Also added diff-envelope structural equivalence (isDiffDocument vs
  validateDiffDocument) and an apply-level op mutant suite.
- Caught self-bug mid-stage: mutants returning `diff.push()`'s number were
  asserting on a number, not the doc — fixed with `void`.
- DONE: core hardening. Next: stage 58.

## Stage 58 — flights reference server added to wire corpus | devin/stage-58-flights-corpus

- Commands: `node --test schema/documents.test.mjs` → 88 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- The reference implementation (examples/flights) emitted manifests that
  were never schema-checked. loadWireCorpus now boots createApp in-process
  on a second ephemeral port and captures 10 real served documents:
  search, results, booking, login, logout, consent, two orders, pay-3ds,
  and the .well-known/agent-page manifest — all validated against
  page-manifest.json in documents.test.mjs. All 10 conform.
- Also verified the earlier "6/9 schema-invalid" report was an artifact of
  synthetic builder args ({} as session/order), not real flights output.
- DONE: core hardening. Next: stage 59.

## Stage 59 — wire corpus through strict client + extension validator | devin/stage-59-wire-hydrate

- Commands: `node --test schema/fuzz.test.mjs` → 1,255 pass / 0 fail;
  `node --test schema/extension-fuzz.test.mjs` → 2,058 pass / 0 fail;
  `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Real served documents (demo lab pages, v1.0 projections, all 10 flights
  routes) now exercise BOTH clients: fuzz.test.mjs strict-hydrates every
  wire manifest through AgentClient; extension-fuzz.test.mjs runs each
  through extension validateManifest. Closes the last corpus gap: real
  wire output × both impls' acceptance paths.
- DONE: core hardening. Next: stage 60.

## Stage 60 — post-apply manifest validation + value-shape parity | devin/stage-60-post-apply

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0;
  `node --test schema/fuzz.test.mjs schema/extension-diff.test.mjs` → 5,502 pass / 0 fail.
- Bug class found: the strict client's diff apply validated only envelope
  shape post-apply — diffs producing corrupt state (unknown node type,
  forbidden member, wrong value shape) were adopted silently while the
  extension rejected them.
- Changes:
  - packages/client/src/hydrate.ts: checkStrictNodes → exported
    checkStateNodes(node,path,strict); ported the extension's full
    value-shape rules (null/string/number/boolean/date/datetime/enum/
    object/array/table/geopoint/order + pagination field checks); member-set
    checks remain strict-only.
  - packages/client/src/diff.ts: applyDiffDocument post-apply now runs
    checkStateNodes on every state root (strict mode when the manifest is
    x-app strict-marked).
  - extension/protocol/validate.js: validateStateNode now rejects
    FORBIDDEN_OBJECT_KEYS as direct node members (was checked only at the
    state root and under object children).
  - schema/extension-diff.test.mjs: 'diff producing corrupt state' — 4
    corruption classes must be rejected by both impls (was: strict accepted
    2).
  - schema/fuzz.test.mjs: the schema-valid→strict-accepts axiom now allows
    rejection only when emit rejects under KNOWN_DIVERGENCE — strict
    hydrate gained value-shape enforcement, so schema-valid semantic
    invalids (e.g. enum value ∉ options) now correctly reject.
- DONE: strict≡lenient post-apply equivalence; receipt-time value-shape
  enforcement now uniform across emit, strict client, extension.
- Next: continue stage loop.

## Stage 61 — post-apply actions-block validation (strict client) | devin/stage-61-actions-post-apply

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0;
  `node --test schema/extension-diff.test.mjs schema/fuzz.test.mjs` → 5,504 pass / 0 fail.
- Bug: strict client adopted diffs corrupting /actions (map→array,
  kind/side_effect outside vocabulary) while the extension rejected them
  post-apply via validateManifest. Probed live: 'action kind bogus' and
  'actions -> array' diverged (strict ACCEPT / lenient reject).
- Changes: packages/client/src/diff.ts post-apply now enforces the lenient
  actions contract (object map ≤128 keys, ACTION_KEY_RE, def object,
  kind ∈ 5-kind vocab, side_effect ∈ 4-value vocab); extension-diff.test
  gained both corruption classes.
- DONE: post-apply contract now covers state + actions on both impls.
- Next: continue stage loop.

## Stage 62 — actions-block validation on receipt (strict client) | devin/stage-62-actions-receipt

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0.
- Same gap as stage 61 but at RECEIPT: strict validateManifest checked
  state nodes but never the actions block — the extension has always
  rejected bad kind/side_effect/key-grammar at hydrate. checkActions moved
  into hydrate.ts (exported, shared with diff post-apply), called
  unconditionally in validateManifest.
- Fixture fix (not a test weakening): receipt.test.ts used
  side_effect:'state_change', outside the spec's 4-value vocab — stale
  pre-vocab data. Now 'safe'; the tests assert conflict-retry behavior.
- DONE: receipt + post-apply action contract identical across impls.
- Next: continue stage loop.

## Stage 63 — state-key grammar + applyOp edge parity | devin/stage-63-state-keys

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0;
  `node --test schema/extension-diff.test.mjs` → 4,259 pass / 0 fail.
- Bug: strict client never checked state-root key grammar — a manifest with
  `state["BAD KEY"]` hydrated while the extension rejected with
  illegal_key. checkStateKeys added to hydrate.ts; called on receipt
  (unconditional) and post-apply.
- Equivalence proven: 9 applyOp edge cases (numeric object keys, array
  index/'-'/idx=len, copy, new-key adds, illegal keys) produce identical
  verdicts AND identical applied state across the hand-rolled extension
  apply and fast-json-patch. Pinned in extension-diff.test.mjs.
- DONE: strict≡lenient state-key grammar + apply semantics.
- Next: continue stage loop.

## Stage 64 — pagination normalization parity | devin/stage-64-paginate-parity

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0;
  `node --test schema/extension-fuzz.test.mjs` → 2,059 pass / 0 fail.
- Bug: strict client normalized contradictory pagination
  (cursor:null + has_more:true → has_more:false + meta.warnings entry)
  on receipt; the extension kept the contradiction. Post-apply the roles
  flipped once extension gained the rule — strict didn't normalize.
- Changes:
  - extension/protocol/validate.js: normalizePaginationInconsistent —
    same flip + warning, run inside validateManifest (receipt + post-apply).
  - packages/client/src/hydrate.ts: normalizePagination exported;
    diff.ts calls it post-apply.
  - schema/generator.mjs: emit-side invariant — generated docs never emit
    contradictory pagination (servers normalize before emit).
  - schema/extension-fuzz.test.mjs: pagination normalization parity test.
- DONE: receipt + post-apply normalization identical both impls.
- Next: continue stage loop.

## Stage 65 — strict-marked manifests in extension | devin/stage-65-strict-marker

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0;
  `node --test schema/extension-diff.test.mjs` → 4,260 pass / 0 fail.
- Bug: extension ignored `x-app.strict` — a strict-marked manifest (closed
  member sets, §5.2#12) was validated leniently; strict client rejected the
  same doc, so the two impls diverged on strict-marked input.
- Changes: STRICT_NODE_MEMBERS/STRICT_PAGINATION_MEMBERS tables in
  extension/protocol/validate.js; validateStateNode(node, path, strict)
  enforces them when `manifest['x-app'].strict === 'strict'` — receipt and
  post-apply both (both go through validateManifest).
- DONE: parity holds for strict-marked documents.
- Next: continue stage loop.

## Stage 66 — strict post-apply unconditional; revert x-app marker | devin/stage-66-strict-always

- Commands: `npm run build` exit 0; `npm test` exit 0; `npm run lint` exit 0;
  `node --test schema/extension-diff.test.mjs` → 4,260 pass / 0 fail.
- Bug: stage 60/65 implemented strict post-apply behind an
  `x-app:{strict}` document marker — not in the spec (§5.3 strictness is
  a CLIENT property) and unreachable: `x-app` is absent from
  MANIFEST_ROOT_KEYS so strict receipt rejects marked docs outright.
- Changes: diff.ts post-apply is now unconditionally strict (checkRootMembers
  - checkStateNodes(strict=true) — same contract as receipt); extension
    reverted to lenient-always (renderer is a production client per §5.3);
    test rewritten as designed-divergence pinning (strict rejects extra
    members, lenient accepts — forward compat).
- DONE: post-apply validation ≡ receipt validation per impl; no invented
  doc markers.
- Next: continue stage loop.

## Stage 67 — delegated auth system (SPEC-AUTH) | devin/stage-67-auth | exit gate: `npm run build` exit 0; `npm test` exit 0 (server 212 + client auth 9 new vectors, auth-run e2e 29/29 checks); `npm run lint` exit 0 | spec + 25 server + 9 client vectors written first, then implemented: HS256 compact-JWS tokens (iss/sub/aud/scope/iat/exp/jti), three grants (client_credentials, authorization_code+PKCE-S256, refresh_token rotation), scope grammar read|act:<id>|class:<side_effect>|*, dogfooded authorize endpoint serving a PageManifest with authorize/deny actions, WWW-Authenticate Bearer headers on 401/403, 5 new error codes registered server+client, client §7 duty-cycle helper (createClientCredentialsAuth: discovery, token cache, refresh rotation, invalid_grant fallback), demo /app-oauth/token + /app/oauth/authorize + delegated lab page, test:auth in npm test | DONE: delegated-auth gap closed — agents get scoped bearer tokens end-to-end | next: optional hosted deploy / store listing.

## Stage 68 — web-app element nodes (SPEC-WEB-NODES) | devin/stage-68-web-nodes | exit gate: `npm run build` exit 0; `npm test` exit 0 (16385 pass incl. 64 node-semantics vectors + generative/mutant sweeps); `npm run lint` exit 0 | spec + ~25 conformance vectors first, then implemented: 4 new StateNode types (embed/markdown/media/tree) in schema/state-node.json + server+client types/validators/hydrate + extension validate/parse; 3 componentHints (gallery/calendar/stepper) in present.json + COMPONENT_TYPES; renderers (embed iframe w/ declarative sandbox→attr map, markdown safe-subset DOM builder, media gallery, tree, calendar, stepper) wired into detail sections + tree-fallback + component hints; v1.0 projector maps all 4 down (embed→object{url,description}, markdown→string, media→array<object>, tree→array<object> recursive); generator + mutations cover new types (mutant coverage list now derived from schema $defs, no drift); demo /app/lab/webnodes page + FEATURES.md row; SPEC.md §5.1.12 forward reference | DONE: web-app element vocabulary landed — every node stays agent-legible structured data, embed keeps mandatory description as the agent-facing substitute | next: optional hosted deploy / store listing.

## Stage 69 — extension default-skin polish + visual-QA aid | devin/stage69-skin-polish

- commands: `npm run build` → 0; `npm test` → 0 (16385 vitest + 221 harness PASS); `npm run lint` → 0.
- changes: styles.css polish — accent section-title bars, brand chip, card hover lift/accent border, button shadow+tactile states, input focus-ring+hover, framed zebra table, styled empty state, media zoom, tree hover, overlay blur, thin scrollbars, ::selection tint; reduced-motion guards; markdown code-block contrast fix (was light-on-light). Added .harness/shot.html (?m=manifest) + fixtures/webnodes.json for visual QA.
- DONE status: user request "more beautiful human render" — skin polished without touching asserted values; verified via shots (store, detail, order, webnodes).
- next: hosted deployment / auth ops endpoints / manifest signing backlog.

## Stage 70 — Vercel deploy scaffolding (protocol landing + demo flights) | devin/stage70-vercel-deploy

- commands: `npm run build` → 0; `npm test` → 0 (17113 assertions); `npm run lint` → 0; `node deploy/protocol-site/build-site.mjs` → wrote data/site.json + data/wellknown.json; local handler simulation: protocol site `/` negotiates (browser→303 /html, APP→manifest), `/manifest.app.json` + `/.well-known/agent-page` 200; demo api/index.mjs: GET /app/ba/home 200, POST search_flights→ba_results_out, select_outbound→ba_results_ret through real middleware.
- changes: deploy/protocol-site/ (api/site.mjs, data/*.json, public/html.html, vercel.json, build-site.mjs); api/index.mjs + root vercel.json + .vercelignore for demo-flight-app; full-server.mjs deps injection; corpus.mjs validates deploy manifests; package.json + site:build script.
- DONE status: deploy code verified locally end-to-end; live deploy blocked on Vercel credentials (asked user).
- next: deploy both projects once VERCEL_TOKEN is provided; then revocation/introspection or manifest signing.

## Stage 71 — Public Vercel deployment | branch: devin/stage70b-deploy-readme

**Commands + exit codes**

- `vercel link --project agent-page-protocol && vercel deploy --prod` → exit 0 (after `includeFiles` string-glob fix); `curl https://agent-page-protocol.vercel.app/` → 303→/html browser, 200 `application/vnd.agent-page+json` under APP Accept; `/manifest.app.json`, `/html`, `/.well-known/agent-page` all 200
- `vercel link --project demo-{flight,hotel,classroom,lab}-app` + `vercel env add APP_DEMO_SITES {ba,hotel,gc,lab}` + `vercel deploy --prod` ×4 → all READY, all aliased
- Live POST `search_flights` on demo-flight-app → 303 → `ba_results_out` (5 flights) through real middleware; POST `inc` on demo-lab-app → 428 `version_required` (middleware enforcing the wire spec live)
- `npm run lint` → exit 0 (1 preexisting warning)

**Changes**

- `api/index.mjs`: `APP_DEMO_SITES` env gates which sites each project serves; index manifest + LANDING HTML filtered to enabled sites; `SITE_CARDS` per-site entry paths.
- `deploy/protocol-site/build-site.mjs` + `public/html.html`: per-demo domains (flight/hotel/classroom/lab); hotel uses `demo-hotel-app-eta` (exact name taken by another Vercel account); classroom entry corrected to `/app/gc/home`.
- `deploy/protocol-site/vercel.json`: `includeFiles` as string glob. Root `public/robots.txt` added (vercel needs an output dir).

**DONE status** — 5 projects live on the public internet: protocol landing + 4 per-domain demos; every URL verified with real HTTP.

**Next** — store listing; revocation/introspection; manifest signing.

## Stage 72 — Launch site content | branch: devin/stage72-launch-page

**What** — Turned agent-page-protocol.vercel.app into the protocol's launch page: benefits, benchmarks, features, manifest schemas, connect-an-agent snippets, GitHub/demo links — as both the APP manifest's structured state and the HTML page.

**Commands + exit codes**

- `npm run site:build` → exit 0 (regenerates data/site.json + data/wellknown.json + html.html)
- `vercel deploy --prod` → exit 0, READY + aliased; live curl verified both readers

**DONE status** — launch page live for agents and humans.

**Next** — richer human HTML.

## Stage 73 — Next.js launch site, APP-first | branch: devin/stage73-nextjs-site

**What** — Rebuilt the launch site as a Next.js app: shadergradient hero, glass-card design, copy-to-clipboard install blocks (agent prompt / MCP config / action call). `/` negotiates on Accept (307 → manifest for agents, rendered page for browsers); HTML is the fallback, `/html` 308s to `/`.

**Commands + exit codes**

- `npm run build` (root) → exit 0; `npm test` → exit 0; `npm run lint` → exit 0 (1 preexisting warning)
- `npm run build && npm start` (protocol-site) → local smoke: `/` browser 200 text/html, APP Accept 307→/manifest.app.json, well-known 200 vnd JSON, /manifest 200, /html 308
- `vercel deploy --prod` ×3 → first: MIDDLEWARE_INVOCATION_FAILED (builder bug bundling node-runtime middleware) → removed middleware.ts, moved negotiation into page.tsx + next.config rewrites; second: all routes 404 (project framework pinned to null from the static-site era — no build ran) → `PATCH {"framework":"nextjs"}`; third: READY
- Live curls: `/` browser 200 text/html; APP Accept 307→/manifest.app.json; /manifest.app.json + /manifest + /.well-known/agent-page 200 `application/vnd.agent-page+json`; /html 308→/

**Changes**

- `deploy/protocol-site/` is now Next.js 15.5.26 (app router): page.tsx (dynamic, Accept-negotiating), globals.css full redesign, ShaderHero.tsx + CopyBlock.tsx client components, route handlers for manifest/discovery, next.config rewrites+redirects, webpack alias for @shadergradient/react's import-only exports map.
- Removed api/site.mjs, public/html.html, vercel.json (superseded). `.prettierignore` now covers `**/.next/`.
- `deploy/README.md` rewritten for the new structure incl. the framework-setting gotcha.

**DONE status** — launch site live as a Next.js app, APP-first: https://agent-page-protocol.vercel.app/ (browser 307-negotiated, manifest at /manifest.app.json).

**Next** — full live E2E across all 5 domains; store listing; revocation/introspection; manifest signing.

## Stage 74 — Launch page mobile layout | branch: devin/stage74-mobile-fix

**What** — The launch page had no mobile layout: the 4-column benchmarks table forced the page wider than a phone viewport, everything shifted left and clipped, and the nav's GitHub button overflowed.

**Commands + exit codes**

- `npm run build` → exit 0; `npm test` → exit 0; `npm run lint` → exit 0
- Puppeteer at 390×844 + 360×740 + 1280×800 against `next start`: `documentElement.scrollWidth` == viewport at all three widths; the only elements wider than the viewport are the table internals inside `.table-scroll` (they scroll in-place, not the page)
- Screenshots at 390px verified: hero h1/sub/CTAs/curl block wrap inside the viewport, benchmarks table scrolls horizontally, Connect copy blocks + schema pills + demo cards fit, nav = logo + icon-only GitHub

**Changes**

- `app/page.tsx`: table wrapped in `.table-scroll`; GitHub link text in `.gh-t` (icon-only on mobile).
- `app/globals.css`: `.table-scroll` + `min-width: 640px` table inside; `.w` gets `min-width: 0; width: 100%` (it was a flex item in the hero row — couldn't shrink below min-content, ending 429px on a 390px screen); `.grid`/`minmax(min(255px,100%),1fr)` + `.stack.two` `minmax(0,1fr)` so tracks shrink; `overflow-x: clip` on html+body as the safety net; expanded `@media (max-width: 700px)` (smaller type, padding, table cells, term/pre, pills, icon-only `.gh`) and new `@media (max-width: 430px)` hiding nav links entirely.

**DONE status** — launch page verified at 360/390/1280px with no horizontal overflow.

**Next** — deploy; then public.

## Stage 75 — real benchmarks + extension download + specs private | devin/stage75-bench-ext-specs | build 0, test 17196/0, lint 0 | launch page + benchmarks/README now cite the measured 2026-09-26 run (7 round trips, ~100x transfer, 88.9% diff savings, 0-byte 304, ~6.6ms p50; tokens ~parity); extension packaged as public/app-extension.zip (v0.5.0, 512K) with Download button + load-unpacked instructions in hero + manifest for_humans/links; docs/specs/ moved to private mosesman831/APP-specs (gitignored, blueprint maintenance clones back); SPEC links → private repo | DONE | next: create APP-specs repo + push split history; deploy site

## Stage 76 — canonical repo links | devin/stage76-repo-rename | build 0, test 0, lint 0 | repo renamed APP-prod → agent-page-protocol; REPO constants, MCP install snippet, CONTRIBUTING, generated site data point at mosesman831/agent-page-protocol | DONE | next: create APP-specs private repo; redeploy site

## Squash — history reset | main rewritten to single root commit e01b210 | lint 0 | all pre-squash history (stages 1–76) preserved only in this file; specs live history moved to mosesman831/APP-specs (specs-export branch); prompts+archive imported there too; remote branches deleted | DONE

## Stage 78 — adopt-APP prompt + migration guides | devin/stage78-adopt-prompt | build 0, test 0, lint 0 | docs/adopt-prompt.md (asks full-vs-canonical, pulls live schema, follows a guide) + canonicalmigration.md + fullmigration.md; site #adopt section w/ CopyBlock + guide cards + nav link; manifest links + README fenced copy block | DONE | next: deploy site; verify #adopt live

## Stage 79 — compact copy buttons + use-APP prompt | devin/stage79-compact-copy-useprompt | build 0, test 0, lint 0 | CopyBtn hides prompt text (long prompts now buttons); docs/agent-setup.md (MCP server install, 10 tools, CLI, raw HTTP, verify) + docs/use-prompt.md; #connect gets setup + wire prompts as buttons; manifest links + README pointer | DONE | next: deploy + verify

## Stage 80 — Multiversal Airways demo (APP+DOM canonical hybrid) | devin/stage80-multiversal | build 0, test 17196/0 (+10 site-bridge), lint 0 | 16 APP manifests (search→fares→seats→extras→pax→review→pay-confirm→confirmation→manage→checkin→boarding→status→loyalty→deals) + manifest→HTML renderer (render-html.mjs, all 20 node types) + /site/ Accept-negotiation + urlencoded form→wire bridge incl. 428 confirm + challenge pages (site-routes.mjs) + human skin (hero/deal JPEGs, marketing, cookie bar, footer) + airline imagery (demo/files/) + demo/test-site.mjs e2e + launch-site demo card; /app/mva/* wire path unchanged; mva enabled in APP_DEMO_SITES default; includeFiles demo/files/** | DONE | next: deploy demo + site; verify /site/mva live

## Stage 81 — Multiversal Airways v2: real-airline DOM surface + 14 new pages (30 Sep 2026)

**Why:** the generated DOM twin read as "AI-generated", not like a real airline, and the APP demo was missing the informational/support features a real airline site carries.

**Renderer v2** (`demo/lib/`): full design system (`skin-css.mjs`) — airline visual language (utility topbar, sticky nav, full-bleed hero with gradient overlay, floating tabbed booking widget, stat strips, photo cards with captions, fat multi-column footer, cookie pill, itinerary `.seg` rows, fare cards, comparison tables with currency/number alignment, toggle/slider/radio/checkbox widgets, calendar + stepper + consent + banner + chart primitives). Whole schema `componentHint` vocabulary now renders. `param_hints` components select the widget rendered inside action forms (slider, toggle, radio_group…). `skin.heroForm` mounts an action form inside the hero widget; `heroTabs`/`strips`/`promos`/`footerColumns` decorate per slug. Split into `render-shared` (helpers) / `render-fields` (forms + tables + sections) / `render-html` (page assembly) to hold the 800-line cap.

**New MVA pages** (14 manifests — `content.mjs` + `services.mjs`): destinations (route network table + gallery), cabins (4-cabin cards + comparison table), baggage (allowance by cabin/fare + fees), fare-finder (28-day lowest-fare calendar component + search), travel-docs (entry rules + doc checker), assistance (services + request flow), disruption (comp rules + refund/comp claim), loyalty (tier table + join), lounges (4 lounges w/ generated imagery), partners (alliance + retail earning), help (FAQ + contact + newsletter subscribe), travel-extras (hotels/cars/insurance catalog), group (10+ quote request), about (story + fleet + facts). 5 new handlers: `check_docs`, `request_assistance`, `claim_refund` (validates booking ref), `subscribe`, `request_quote` — all verified end-to-end through the site bridge (form POST → mutate → re-rendered DOM twin).

**Gate:** 50/50 manifests valid, site bridge 10/10, 17,196 tests, lint clean. Verified visually — reads as a real airline.

## Stage 83 — classroom demo rebuild (Classwork)

**Why:** every demo site, not just the airline, should carry the full feature surface of a real product in its category — a classroom platform needs to-do, calendar, materials, notifications, archive, help, and a real visual identity, on both readers (APP manifests + generated DOM).

**Classwork demo** (`demo/google-classroom/`): 6 new manifests in `extra.mjs` — `todo` (assigned + done tables across classes), `calendar` (calendar component + upcoming grid), `materials` (sortable/filterable library table), `notifications` (feed + settings toggles), `archived` (classes table + restore note), `help` (FAQ + stats). 5 new handlers in `handlers.mjs` — `join_class` (code lookup, duplicate-enroll guard), `comment` (posts a stream entry as Ada Osei), `submit_work` (assignment status → turned_in + private comment), `attach_file` (pushes file node into your_work attachments), `toggle_notify` (settings booleans + saved notice). `skin.mjs` gives the generated DOM a Classwork identity: green palette, topbar nav (Classes / To-do / Calendar / Archived / Notifications), utility nav, promo explainer, 4-column footer, board favicon.

## Stage 84 — protocol lab console

**Why:** the lab is a developer console, not a consumer site — it needed its own dark console chrome plus pages that read like a console (playground, status, changelog) without breaking the 15 feature pages conformance tests depend on.

**Protocol Lab** (`demo/protocol-lab/`): 3 new manifests in `pages-console.mjs` — `playground` (one action carrying every param type — text, quantity slider, money, boolean, enum, array, date, date_range — echoed back verbatim by `inspect_params`), `status` (protocol signals table + stats), `changelog` (wire releases + versioning policy). `inspect_params` handler in `full-server.mjs` echoes wire params into `state.last_echo`. `skin.mjs` adds a dark developer-console skin (mono logo, terminal palette, status/changelog links). `demo/validate.mjs` now validates lab manifests too — 74/74 valid.

**Gate:** all manifest sets valid, site bridge 10/10, lint clean, wire `inspect_params` verified with every param type (quantity, money, array, date_range).

## Stage 85 — column date/datetime/percent formatting

Table cells declared `format: 'date' | 'datetime' | 'percent'` in section columns now render formatted in the generated DOM (`5 Oct` / `1 Oct, 23:59` / `88%`) instead of raw values. Classwork tables (due soon, classwork, gradebook, students) declare their column formats — due dates no longer render as raw ISO strings.
