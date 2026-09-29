# Contributing

## Setup

```sh
git clone <this-repo> && cd agent-page-protocol
npm ci
npm run build   # tsc all workspaces
npm test        # vitest suites + node:test payment-seam vectors + extension harness
npm run lint    # eslint + prettier --check
```

Requires Node ≥ 18 (see `package.json` `engines`; developed and verified on v24). For the extension
harness a Chromium binary must be reachable — puppeteer downloads one on `npm ci`
(cache under `~/.cache/puppeteer`); `PUPPETEER_EXECUTABLE_PATH` overrides.

## Golden rules

- **Vectors before code.** Any change to `schema/`, `packages/server`,
  `packages/client`, or `packages/conformance` starts with the spec edit in
  `docs/specs/` plus new conformance vectors. Implement second.
- **Never weaken a test to go green** — no deletes, `.skip`, `.only`, or loosened
  assertions.
- **No new runtime dependency** without a one-line justification in
  `docs/ARCHITECTURE.md` ("why couldn't an existing dep do it").
- **`npm run lint` must exit 0** — do not add `eslint-disable`/`prettier-ignore`
  comments to get there; fix the code or the config.
- Root stays clean: only `README.md`, `LICENSE`, `package.json`,
  `package-lock.json`, `.gitignore`, `PROGRESS.md`, and source directories. Specs go
  in `docs/specs/` — the private `mosesman831/APP-specs` repo cloned into that path (gitignored here; commit spec changes in that repo, not this one).

## Making changes

1. Branch: `git checkout -b devin/<slug>` (or your convention); one change per branch.
2. Exit gate before merging: `npm run build && npm test && npm run lint` all green.
3. Merge to `main` with `git merge --no-ff`; commit style is imperative
   (`test(extension):`, `refactor(conformance):`, `docs(...)`).
4. Log the stage in `PROGRESS.md` — commands, exit codes, what changed.

## Adding a conformance vector (TV-141+)

1. Spec first: describe the behavior in `docs/specs/SPEC.md` (or the relevant spec).
2. Wire the route on the harness server: `packages/conformance/src/server/v11.ts`
   (or `fixtures.ts` for page fixtures).
3. Add the runner in `packages/conformance/src/vectors/runs/` — pick the file whose
   TV range it lands in (`v10-early`, `v10-late`, `v11-early/mid/late`); add the thin
   `src/vectors/TV-NN.ts` wrapper and register the vector in `src/vectors/index.ts`.
4. `npm test -w @agent-page/conformance` — the vector runs automatically.

Any new wire document shape is automatically validated against the extension's JS
implementation by `test/extension-equivalence.test.ts` — if the two implementations
disagree, the test fails and tells you which side diverged from the spec.

## Extension work

- Plain JavaScript, no build step. Load `extension/` unpacked in Chrome.
- Assertions run under `npm test` via `extension/.harness/run-node.mjs` against
  `extension/.harness/fixtures/*.json`.
- **Fixtures are generated, never hand-edited:** `npm run gen:fixtures` rebuilds them
  from `@agent-page/conformance` builders; `--check` (inside `npm test`) fails on
  drift. Change the generator (`generate-fixtures.mjs`), then regen + commit.
- Money/currency formatting lives only in `extension/protocol/money.js` — import it.
- Protocol-version handling must stay symmetric with `@agent-page/client`
  (`1.0` and `1.1` are both supported wire versions).

## Where things are

See `docs/ARCHITECTURE.md` for the layout table, the file-size budget, and the
dependency rationale.
