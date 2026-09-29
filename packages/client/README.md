# @agent-page/client

Reference **Agent Page Protocol (APP)** agent client. Implements SPEC §7 (diff), §8 (navigation), §10 (security/policy), §15 (agent patterns), and §16 performance hygiene.

## Install

```bash
npm install @agent-page/client
```

## Quick start

```ts
import { AgentClient, searchFilterBook } from '@agent-page/client';

let token = '...';

const client = new AgentClient({
  getAuthHeaders: () => ({ Authorization: `Bearer ${token}` }),
  onAuthRefresh: async () => {
    token = await refreshToken();
    return true; // retry once on 401 (§9.4)
  },
  onConfirm: async (req) => {
    // Agents MUST use 428 challenge-echo — never client UUID (§10.4)
    if (req.challenge) {
      await approveWithHuman(req);
      return { approved: true, confirmationToken: req.challenge };
    }
    return approveWithHuman(req);
  },
  policy: { scopes: ['flights:read', 'flights:book'] },
});

const manifest = await client.hydrate('https://example.com/search');
const actions = client.listActions(manifest); // §15.5
const forLlm = client.forPlanner(manifest); // strip present + redact secrets (§15.7)

const { manifest: next, mode } = await client.invoke(manifest, 'filter', {
  max_price: 700,
});
```

## Architecture (§15.1)

```
AgentClient / AgentRuntime
  ├─ AppHttpClient   Accept headers, auth, Origin / X-APP-Origin
  ├─ ManifestCache   URL → {manifest, etag, version, fetchedAt}
  ├─ DiffEngine      RFC6902 subset, atomic apply, stale_base
  ├─ ActionPolicy    side_effect gates L0–L4
  ├─ Navigator       template expand, cycle detect, same-origin
  └─ ActionDispatcher confirmation challenge-echo, per-page mutex
```

## Supported patterns

| Pattern                     | API                                            |
| --------------------------- | ---------------------------------------------- |
| Freshness / If-None-Match   | `hydrate()` + `ManifestCache`                  |
| Diff + version check        | `applyDiff()` / invoke diff responses          |
| Action selection            | `listActions()`                                |
| Serialize non-idempotent    | per-page `PageMutex` in `invoke()`             |
| Token budget                | `forPlanner()` / `stripPresent()` / `redact()` |
| Search→Filter→Book          | `searchFilterBook(client, opts)`               |
| Auth refresh once           | `onAuthRefresh`                                |
| Confirmation challenge-echo | `onConfirm` + 428 handling                     |
| Navigation cycles           | `NavigationStack` (§8.6)                       |
| Same-origin                 | enforced on actions & navigation               |

## API

```ts
class AgentClient {
  constructor(options: {
    fetch?: typeof fetch;
    getAuthHeaders?: () => Record<string, string> | Promise<...>;
    onConfirm?: (req: ConfirmationRequest) => Promise<boolean | { approved; confirmationToken? }>;
    onAuthRefresh?: () => boolean | Promise<boolean>;
    policy?: ActionPolicy | ActionPolicyOptions;
  })

  hydrate(url: string): Promise<PageManifest>
  invoke(url | manifest, action, params?, opts?): Promise<InvokeResult>
  applyDiff(manifest, diffDoc): PageManifest
  expandNavigate(actionDef, params, baseUrl): string
  listActions(manifest): ActionSummary[]
  forPlanner(manifest, topK?): Omit<PageManifest, 'present'>
}
```

`AgentRuntime` is an alias of `AgentClient`.

## Scripts

```bash
npm install
npm run build
npm test
```
