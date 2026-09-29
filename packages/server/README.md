# `@agent-page/server`

Reference Express middleware for the [Agent Page Protocol](../../docs/specs/SPEC.md) (APP).

Serves Page Manifests, validates action requests, emits Diff Documents, and enforces CSRF, idempotency, confirmation, and version conflict rules from SPEC §§2–12.

## Install

```bash
npm install @agent-page/server express
```

## Quick start

```ts
import {
  createAppServer,
  bumpVersion,
  type PageManifest,
  type ActionHandler,
} from '@agent-page/server';

let manifest: PageManifest = {
  app: '1.0',
  page: {
    id: 'demo',
    url: 'http://localhost:3000/',
    title: 'Demo',
    version: 'v1',
  },
  state: {
    count: { type: 'number', value: 0, label: 'Count' },
  },
  actions: {
    increment: {
      description: 'Add one',
      kind: 'query',
      input: {},
      output: { state_diff: true },
      side_effect: 'safe',
      idempotent: true,
    },
  },
};

const increment: ActionHandler = async ({ manifest: current }) => {
  const next: PageManifest = structuredClone(current);
  const node = next.state.count as { type: 'number'; value: number };
  node.value += 1;
  next.page.version = bumpVersion(current.page.version);
  return { type: 'diff', nextManifest: next };
};

const app = createAppServer({
  pageOrigin: 'http://localhost:3000',
  getManifest: async () => manifest,
  actionHandlers: { increment },
});

app.listen(3000);
```

### GET manifest

```http
GET / HTTP/1.1
Accept: application/vnd.agent-page+json
```

Response includes `Content-Type: application/vnd.agent-page+json`, `X-APP-Version`, `X-APP-Page-Id`, `X-APP-Response-Mode`, `ETag`, and `Vary: Accept`.

### POST action

```http
POST / HTTP/1.1
Accept: application/vnd.agent-page-diff+json, application/vnd.agent-page+json
Content-Type: application/vnd.agent-page-action+json
Origin: http://localhost:3000
X-APP-If-Match-Version: v1

{"app":"1.0","action":"increment","params":{}}
```

## API

| Export                                               | Role                                                |
| ---------------------------------------------------- | --------------------------------------------------- |
| `createAppServer(options)`                           | Express app with JSON parser + APP page handler     |
| `createPageHandler({ getManifest, actionHandlers })` | Request handler for GET/POST                        |
| `appMiddleware(options)`                             | Lightweight helper middleware                       |
| `ActionHandler`                                      | `(ctx) => ActionResult`                             |
| `ActionResult`                                       | `{ type:'diff'\|'full'\|'navigate'\|'async', ... }` |

### Action results

```ts
{ type: 'diff', nextManifest }
{ type: 'full', manifest }
{ type: 'navigate', url, mode?, manifest? }
{ type: 'async', jobId, pollIntervalMs }
```

## Protocol features

- Content negotiation (`Accept` → manifest / diff / 406)
- `X-APP-If-Match-Version` → `409 app.err.diff.conflict`
- `If-None-Match` → `304`
- Idempotency keys (24h TTL; body mismatch → `409 app.err.action.idempotency_conflict`)
- Confirmation (428 challenge-echo, 300s, single-use, param binding)
- CSRF: `Origin` priority; `X-APP-Origin` only when `Origin` absent
- Table StateNode validation + pagination helpers
- Async pending + `meta.poll_interval_ms` / `app.err.action.async_pending`
- Error envelopes: `application/vnd.agent-page-error+json`

## Scripts

```bash
npm install
npm run build
npm test
```
