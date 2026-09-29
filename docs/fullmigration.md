# Full migration — APP manifests are the page documents

The manifest **is** your page. Agents consume it natively; humans view it
through the Chrome extension (or a thin HTML fallback you keep only for
no-extension traffic). This is for agent-first surfaces — dashboards, agent
docs, API-adjacent pages — or products betting on the extension.

Reference implementation: this repo's own launch site runs APP-canonical —
`GET /` returns a 307 to `/manifest.app.json` for `Accept:
application/vnd.agent-page+json` and HTML for browsers
(`deploy/protocol-site/`).

## 0. Commit to the document model

There is no DOM to fall back on for correctness — your manifest must carry
everything a reader needs: state, actions, navigation, session. Design each
page's state tree first (20 node types — `schema/state-node.json`), actions
with declared params/idempotency/side effects, `present` layout + component
hints. Show the manifest JSON to a human before building emitters.

## 1. Serve manifests as primary documents

```ts
import { createAppServer } from '@agent-page/server';

createAppServer({
  getManifest: (req) => manifestFor(req.path, loadState(req)),
  actionHandlers: { … },
});
```

Serving order — the manifest is the answer to `GET`, not a side channel:

```
Accept: application/vnd.agent-page+json  → Page Manifest (the page)
Accept: text/html                        → thin HTML shell or redirect to
                                           a static fallback page
```

The fallback's only job is telling extension-less humans what to install —
keep it static, don't rebuild your UI in HTML (that recreates the two-UI cost
you're eliminating). Point it at
`https://agent-page-protocol.vercel.app/app-extension.zip`.

## 2. Everything lives in the manifest

- Navigation → `navigation` member (agents follow page links; humans click
  rendered links).
- Auth → `session` member + delegated auth (`createAuthServer` — scoped
  bearer tokens for agents acting on a user's behalf).
- Human-only UX → `present.components` hints (chart, calendar, stepper,
  gallery) render natively in the extension while staying structured for
  agents.
- Opaque third-party widgets → `embed` nodes (sandboxed iframe + mandatory
  `description` so agents know what the box contains).
- Rich copy → `markdown` nodes; galleries → `media`; hierarchies → `tree`.

## 3. Keep the wire contract — it's now load-bearing

Everything in `canonicalmigration.md` §4 applies with higher stakes:

- Idempotency keys and version headers protect actions that no longer have a
  human double-checking a form.
- Confirmation challenges (`428` → `X-APP-Confirmation`) are your only
  guardrail on irreversible actions — set `side_effect` honestly.
- Diffs + ETag/`304` are now your update path _and_ your caching story.
- Discovery: `/.well-known/agent-page` must be correct — it's how agents
  find capabilities, schema versions, and auth endpoints.

## 4. Ship gates

1. Every emitted document validates against `schema/manifest.json`
   (`npm run schema:check -- <file>` or ajv).
2. An agent completes your core flow end-to-end via MCP/CLI alone — no
   human. (`packages/cli`: `agent-page open`, `agent-page act` …)
3. The extension renders every page without console errors (see
   `extension/.harness/` for automated render assertions).
4. Your HTML fallback (if any) clearly routes humans to the extension —
   nothing else; don't maintain a second UI.

## 5. What you're giving up (say it out loud)

No-extension humans get a fallback page, not your product. SEO/assistive
tech/regulatory audits operate on HTML — if those matter for the surface,
canonical+negotiation (`canonicalmigration.md`) is the better answer. Full
migration is for surfaces where the readers are agents.
