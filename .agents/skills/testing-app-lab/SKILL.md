---
name: testing-app-lab
description: E2E-test the APP Chrome extension against the protocol-lab demo server (serve.mjs/full-server.mjs), including the environment's click-coordinate offset quirk and the curl headers the middleware requires.
---

# Testing the APP extension against the protocol lab

## Setup

- Demo server: `PORT=8790 node demo/serve.mjs` from the repo root (serves `createFullDemoApp` from `demo/full-server.mjs` — the real `@agent-page/server` middleware). Kill a stale listener with `fuser -k 8790/tcp`.
- Lab pages: `http://127.0.0.1:8790/app/lab/home` — routes: `counter`, `async`, `secure`, `consent`, `rate`, `idem`, `soft`, `typeahead`, `delegate`, `delegate-done`, `bulk`, `showcase`.
- Extension: "Agent Page Protocol Renderer" (MV3, unpacked from `extension/`). Verify at `chrome://extensions`; reload via the reload icon after code edits. Content-script (`content-script.js`, `render-root.js`) changes take effect on **page reload**; `service-worker.js` changes require the **extension reload**.
- Demo OTP is `123456` (`/app/lab/secure` login accepts any user/pass; `demo`/`demo` is canonical).
- Only `/app/lab/counter` declares `meta.events_url` (`/app-events` SSE). It is the page most likely to surface SSE-related bugs.

## Environment quirk: screenshot-vs-click coordinate offset (verify before reporting dead UI!)

The computer tool's 1024x768 coordinate space maps **nonuniformly** onto the real display (~1600x1156). Clicks can land ~15-18px off where screenshots show elements — a click aimed at a button's visual center may hit a parent `FORM`/`FIELDSET` a few px away and do nothing, looking like a "dead button" bug.

Before declaring a UI element dead:

1. Prefer **keyboard activation** (click the field, `Tab` to the button, `Return`) — it bypasses hit-testing entirely.
2. Or aim ~18px lower than the visual center and retry.
3. For definitive evidence, temporarily add a capture-phase `click` listener inside the extension's closed shadow DOM (in `render-root.js` `mount()`) that logs `e.clientX/e.clientY`, `e.target`, and every button's `getBoundingClientRect()` — the listener sees true targets even though page-context JS cannot pierce the closed shadow.
4. Rule out a **native JS dialog**: a stray `alert`/`confirm`/`prompt` freezes the whole renderer (and page-context console evals will refuse to run). Press `Escape` to dismiss.

## Curling the middleware directly

GETs: `-H "Accept: application/vnd.agent-page+json" -H "X-APP-Accept-Versions: 1.0, 1.1"`.

POSTs require ALL of: `Content-Type: application/vnd.agent-page-action+json`, `Origin: http://127.0.0.1:8790` (else 403), `X-APP-Idempotency-Key: <unique>` (else 400), `X-APP-If-Match-Version: <current page.version>` (else 428), `X-APP-Accept-Versions: 1.0, 1.1`. Read the current version from a GET first; it changes after every mutation. `inc`-style actions may take **no params** — extra fields are rejected as `unknown_param`.

SSE: `curl -sN -H "Accept: text/event-stream" http://127.0.0.1:8790/app-events` — replays the whole server `eventLog` when no `Last-Event-ID` is sent (useful for spotting stale-diff replay problems).

## Diagnostics that worked

- `ss -tnp | grep 8790` — Chrome holds max 6 connections per origin (HTTP/1.1); if an action POST hangs with the server never receiving it, check for a saturated pool (SSE + revalidate churn can pin all 6 — wedges the tab completely, even blocking F5 navigation).
- Page-context `browser_console` evals cannot see inside the closed shadow root (`#app-ext-root`) — instrument `render-root.js` instead, and revert **only your own added lines** afterward (never `git checkout -- <file>` — it can clobber others' uncommitted work).
