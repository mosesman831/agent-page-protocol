# Canonical migration — APP alongside your DOM (auto-negotiation)

You keep HTML for humans and serve APP manifests to clients that ask for them
on the **same URLs**. The web keeps working untouched; agents get a typed
document instead of scraping the DOM.

The target end state: `GET /page` returns HTML for browsers and a Page
Manifest when the request carries `Accept: application/vnd.agent-page+json`.

## 0. Decide what "page" means in APP

Each route becomes one Page Manifest: `state` (the page's data as typed nodes)

- `actions` (what may be done from here) + `present`/`navigation`/`session`
  metadata. Read `schema/manifest.json` + `schema/state-node.json` before
  designing — the node vocabulary is 20 types (`str`, `num`, `enum`, `date`,
  `table`, `media`, `tree`, `embed`, `markdown`, …).

## 1. Inventory

List every route, its backing data, and its user actions. Produce a mapping
table — one manifest per route, actions become `action-def`s with declared
`params`, `idempotent` flags, `side_effect`s. Show it to a human before
coding.

## 2. Emit manifests

Use `@agent-page/server` — it implements the entire wire contract for you
(negotiation, validation order, diffs, idempotency, confirmation, sessions,
well-known discovery):

```ts
import { createAppServer } from '@agent-page/server';

const app = createAppServer({
  getManifest: (req) => manifestFor(req.path, loadState(req)),
  actionHandlers: {
    search: async (req, params) => { /* mutate/query */ return { diff: … }; },
    add_to_cart: async (req, params) => …,
  },
});
```

`getManifest` returns a `PageManifest` object; action handlers return a diff
or the next manifest. Validate every manifest against `schema/manifest.json`
(ajv or `npm run schema:check -- <file>`) — emitting invalid JSON is the most
common integration failure.

## 3. Negotiate on the same URL

```
GET /app/ba/home
Accept: application/vnd.agent-page+json            → Page Manifest
Accept: text/html                                  → your HTML (unchanged)
```

Mount order matters: the APP middleware handles `Accept`-negotiated and
`vnd.agent-page-action+json` POSTs; let everything else fall through to your
existing routes. Well-known discovery: `GET /.well-known/agent-page` returns
the capabilities document (the middleware serves it).

## 4. Actions over POST — the wire contract

```
POST <action_url>
Content-Type: application/vnd.agent-page-action+json
{"app":"1.1","action":"<id>","params":{...}}
```

- `X-APP-Idempotency-Key` (`^[A-Za-z0-9_-]{8,128}$`) on every non-idempotent
  action — replays must return the stored result.
- `X-APP-If-Match-Version` on versioned actions — `428 version_required`
  without it; `409` on stale.
- `428` + confirmation challenge for financial/irreversible actions — the
  client resends with `X-APP-Confirmation`.
- Responses: next manifest, RFC 6902 diff (`vnd.agent-page-diff+json`), or
  error envelope (`vnd.agent-page-error+json`).

## 5. Optional upgrades (in order of value)

Diffs for updates (bandwidth), ETag/`304` revalidation, session state
(`session` member + `Set-App-Resume`), async operations (202 + `status_url`),
consent gates, delegated auth (`createAuthServer`).

## 6. Verify both readers

```bash
curl -H 'Accept: application/vnd.agent-page+json' https://yoursite/page
# manifest JSON

curl -X POST https://yoursite/page \
  -H 'Content-Type: application/vnd.agent-page-action+json' \
  -H 'X-APP-Idempotency-Key: t-000001' \
  -d '{"app":"1.1","action":"search","params":{}}'
```

Then install the extension (`chrome://extensions` → Load unpacked →
`extension/`) and load the page — humans should see your manifest rendered.
If it renders, your state vocabulary is correct; if agents can drive it, your
action contract is correct. Both on one URL = canonical migration done.
