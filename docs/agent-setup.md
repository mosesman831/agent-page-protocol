# Agent setup — give your agent APP access

APP (Agent Page Protocol) pages are JSON manifests: typed state + declared
actions. Three ways to connect an agent, best first.

## 1. MCP server (recommended)

`@agent-page/mcp` is a stdio MCP server — 10 fixed tools (`app_discover`,
`app_open`, `app_read`, `app_act`, `app_confirm`, `app_challenge`,
`app_sessions`, `app_watch`, `app_logout`, `app_reset`).

Build once:

```bash
git clone https://github.com/mosesman831/agent-page-protocol
cd agent-page-protocol && npm ci && npm run build
```

Then point your MCP client at `packages/mcp/dist/bin.js`. Config shapes:

```json
{
  "mcpServers": {
    "agent-page": {
      "command": "node",
      "args": ["/absolute/path/to/agent-page-protocol/packages/mcp/dist/bin.js"]
    }
  }
}
```

That JSON works verbatim in Claude Desktop (`Settings → Developer → Edit
Config`) and Cursor (`~/.cursor/mcp.json`). Other clients: same command/args.
Restart the client after adding it — tools appear on next launch.

## 2. CLI (no MCP client needed)

`packages/cli` builds `agent-page` — a stateful driver a script or a
deterministic agent can shell out to:

```bash
agent-page open https://demo-lab-app.vercel.app/app/lab/home
agent-page read
agent-page act inc --params '{}'
agent-page watch          # streams diffs
```

## 3. Raw HTTP (last resort / teaches the protocol)

Any HTTP client works — the whole contract fits in one card:

```
GET  <page-url>  + Accept: application/vnd.agent-page+json → Page Manifest
POST <action_url> + Content-Type: application/vnd.agent-page-action+json
     body {"app":"1.1","action":"<id>","params":{...}}
     → next manifest, RFC 6902 diff, or error envelope
X-APP-Idempotency-Key (8–128 chars) on non-idempotent actions;
X-APP-If-Match-Version on versioned actions (428 = resend with it);
financial actions may 428 — resend with X-APP-Confirmation.
Discovery: GET <origin>/.well-known/agent-page
```

## Verify

Any of the paths above should be able to:

```bash
curl -H 'Accept: application/vnd.agent-page+json' \
  https://demo-lab-app.vercel.app/app/lab/home
```

— a JSON manifest comes back. Then run the `inc` action (needs an
idempotency key + `If-Match-Version`) or just read the manifest. Live
demo fleet: `demo-flight-app`, `demo-hotel-app-eta`, `demo-classroom-app`,
`demo-lab-app` on `*.vercel.app`.
