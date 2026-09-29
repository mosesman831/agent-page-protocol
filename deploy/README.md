# Deployment

Five Vercel projects serve APP over the public internet: the protocol's own page
plus one project per demo site.

## agent-page-protocol.vercel.app — `deploy/protocol-site/`

The protocol's own page, a Next.js app that is APP-first with the HTML page as
the human fallback (dogfooding):

- `GET /` — `app/page.tsx` is dynamic: if `Accept` includes
  `application/vnd.agent-page+json` it issues a `307` to `/manifest.app.json`;
  browsers get the rendered launch page (shadergradient hero, copy-paste agent
  install blocks, benefits/features/benchmarks/schemas/demos).
- `GET /manifest.app.json` + `GET /manifest` — route handlers serving the
  manifest as `application/vnd.agent-page+json` (canonical agent ingest URLs).
- `GET /.well-known/agent-page` — `next.config.mjs` rewrite to
  `app/api/discovery/route.ts` (app-router routes can't hold a `.well-known`
  path segment).
- `GET /html` — `308` back to `/` (keeps the old fallback link working).

`data/site.json` + `data/wellknown.json` are generated — edit
`build-site.mjs`, run `npm run site:build`, and the schema corpus (`npm test`)
re-validates them. `@shadergradient/react` needs a webpack specifier alias in
`next.config.mjs` (its exports map only exposes an `import` condition).

**Vercel project setting**: `framework` must be `nextjs`. It was created when
this directory was a static site (`framework: null`), which made Vercel serve
`public/` and skip the build — every route 404'd. Fix once via
`PATCH /v9/projects/<p> {"framework":"nextjs"}`.

## Demo apps — repo root (`api/index.mjs` + root `vercel.json`)

One project per demo site, all running the same function; each project's
`APP_DEMO_SITES` env var picks which site(s) it serves:

| Project              | `APP_DEMO_SITES` | Live URL                                               |
| -------------------- | ---------------- | ------------------------------------------------------ |
| `demo-flight-app`    | `ba`             | https://demo-flight-app.vercel.app/app/ba/home         |
| `demo-hotel-app`     | `hotel`          | https://demo-hotel-app-eta.vercel.app/app/hotel/search |
| `demo-classroom-app` | `gc`             | https://demo-classroom-app.vercel.app/app/gc/home      |
| `demo-lab-app`       | `lab`            | https://demo-lab-app.vercel.app/app/lab/home           |

(`demo-hotel-app.vercel.app` is taken by another Vercel account, so that
project serves its auto-assigned `-eta` suffix.)

Routes per project:

- `GET /` — browsers → HTML landing; APP Accept → index manifest.
- `GET|POST /app/<site>/<slug>` — manifests + actions (negotiation, version
  pinning, CSRF, idempotency, confirmations, diffs, async, rate limits, auth).
- `GET /.well-known/agent-page`, `/app-events` (SSE, best-effort — function
  lifetime is bounded), `/operations/*`, `/app-oauth/token`, `/demo/files/*`.

`full-server.mjs` takes `deps: {express, server}` so the serverless bundle's
imports are statically traceable. Sites rebuild per request `Host`, so preview
deployments work unchanged. **State is in-memory per warm instance** — cold
starts reset it; fine for a demo.

## Deploy

```bash
# protocol site (from deploy/protocol-site/)
npx vercel@latest deploy --prod

# one demo app (from repo root; repeat per project)
npx vercel@latest link --project demo-flight-app --yes
printf 'ba' | npx vercel@latest env add APP_DEMO_SITES production
npx vercel@latest deploy --prod
```

Add `--token $VERCEL_TOKEN` for non-interactive use. First deploy creates each
project with the given name — the `<name>.vercel.app` URL follows from it
(auto-suffixed if the name is taken).
