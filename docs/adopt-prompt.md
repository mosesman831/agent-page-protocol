# Adopt APP — paste into a coding agent

Copy everything between the fences below and paste it into your coding agent
(Cursor, Copilot, Claude Code, Devin, …). The agent will ask you one question
(full migration vs. canonical + negotiation), fetch the live schema from this
repo, then follow the matching migration guide.

This file is also rendered on the launch site:
<https://agent-page-protocol.vercel.app> — "Adopt APP" section, copy button.

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
     clients that send `Accept: application/vnd.agent-page+json`
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
  repo's `npm run schema:check`), run the repo's conformance vectors if
  applicable, then show me how to verify both readers:
    agent:  curl -H 'Accept: application/vnd.agent-page+json' <page-url>
    human:  the Chrome extension (Load unpacked → extension/, or
            https://agent-page-protocol.vercel.app/app-extension.zip)
```
