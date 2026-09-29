# demo/

Three example sites served as **APP page manifests** (`application/vnd.agent-page+json`) and
rendered by the real extension renderer — no DOM/HTML from the "site", only JSON.

```
npm run demo          # serve http://127.0.0.1:8788
npm run test:demo     # validate every manifest against the schema + state rules
```

Open <http://127.0.0.1:8788> and click a page. The viewer at `index.html` mounts the real
`AppRenderer` from `extension/renderer/` and plays the host role: NAVIGATE messages from
rendered pages load the next manifest, and INVOKE_ACTION is POSTed to the demo server, which
answers with `mode: 'full'` action results (`output.navigates_to` chains pages).

## Sites

| Site                                       | Path prefix    | Pages                                                                                                                                                                               |
| ------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **British Airways** — full booking flow    | `/app/ba/…`    | home search → outbound results → return results → fare brands → seat map → passenger details → pay (financial action w/ confirmation + secret params) → confirmation/PNR            |
| **HotelHub** — hotel booking               | `/app/hotel/…` | search → results w/ filters → hotel detail → rooms & rates → checkout → confirmation                                                                                                |
| **Classroom** — Google-Classroom-style LMS | `/app/gc/…`    | dashboard → class stream → classwork → assignment (file upload) → grades → people                                                                                                   |
| **Protocol Lab** — one page per feature    | `/app/lab/…`   | counter (diff/etag), async job (202/poll), secure (OTP challenge + session), consent, rate-limit, idempotent pay, soft error, typeahead, delegate handoff, bulk, component showcase |

## Files

- `serve.mjs` — `node:http` server: GET `/app/<site>/<slug>` returns a manifest; POST invokes
  the named action and follows its `output.navigates_to`.
- `viewer.js` — host shim + `AppRenderer` bootstrap; hash routing `#<site>/<slug>`.
- `index.html` — viewer shell (page picker nav + renderer mount).
- `validate.mjs` — runs `classifyDocument` + `validateManifest` (extension) and
  `isPageManifest` + `validateManifestState` (packages dist) over every page; wired into
  `npm test` as `test:demo`; the sweeps run as `test:features`.
- `lib/nodes.mjs` — small manifest builders (`str`, `num`, `money`, `enumN`, `obj`, `arr`,
  `table`, `order`, `action`, `navAction`, `doc`, …).
- `british-airways/`, `hotel-booking/`, `google-classroom/`, `protocol-lab/` — page modules.

## Full protocol server

`serve.mjs` lazily mounts `demo/full-server.mjs`, which runs the real
`@agent-page/server` `createPageHandler` for every site — true wire semantics
(428 challenge/confirmation gates, `X-APP-*` headers, JSON-Patch diffs,
`X-APP-Idempotency-Key`, `X-APP-If-Match-Version`, CSRF origin checks), plus
`GET /app-events` (SSE + longpoll) and `GET /operations/:jobId` (async polling).
If the workspace isn't built it falls back to the basic navigate-only handler,
so `npm run demo` still works on a bare clone.

## E2E sweeps (`test:features`)

- `features-run.mjs` — MCP stdio driver exercising every fixed tool, every
  `app://` resource, and `--dynamic-tools` projection; run twice (fixed +
  dynamic modes).
- `features-cli.mjs` — `agent-page` CLI binary over the same surface
  (discover/open/act/state/watch/navigate, challenge + confirm holds,
  sessions, logout/reset).
- `agent-run.mjs` — scripted MCP booking of the whole BA flow (separate
  `test:agent`).
- `FEATURES.md` — the feature-to-evidence coverage matrix.

`british-airways/` is split into `search.mjs` (search → fares) and `checkout.mjs`
(seats → confirmation) with shared helpers in `common.mjs` to stay under the 800-line cap.

## Renderer notes (discovered writing these)

- Form fields live on the **primary action's `input` map**, not in state nodes; state is
  display data only. A `form` layout section renders inputs for every param of its
  `primary_action` (or the first non-`confirm` action).
- `order`- and `geopoint`-typed state nodes are auto-rendered — don't also add them as
  `present.components` hints or they render twice.
- Table columns get labels/formats from `section.columns`; a `format: 'currency'` column
  reads its scale from `state.<colKey>_scale` or `state.price_scale` (a `num` node, e.g.
  `num(2)` for pence-per-pound).
- Action replies must be wrapped with `createMessage('ACTION_RESULT', payload)` from
  `extension/protocol/messages.js` — a bare `{type:'ACTION_RESULT'}` object fails
  `isAppExtMessage` and is dropped.
