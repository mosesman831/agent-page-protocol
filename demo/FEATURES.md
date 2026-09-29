# Feature coverage matrix

Every APP protocol feature and where it is verified live. `test:features`
(`demo/test-features.mjs`) boots `serve.mjs` on an ephemeral port and runs
three sweeps in one invocation:

- `features-run.mjs` — MCP fixed-tools mode (30 checks)
- `features-run.mjs --dynamic` — MCP dynamic per-action projection (31 checks)
- `features-cli.mjs` — the `agent-page` CLI binary (18 checks)

All sites are served by the real `@agent-page/server` `createPageHandler`
(demo/full-server.mjs), so the sweeps exercise the true wire contract: media
types, version negotiation, CSRF, idempotency, diff encoding, hold gates.

| Feature             | Wire detail                                                                                                      | Live evidence                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Discovery           | `GET /.well-known/agent-page`, capabilities + entry_urls from `state.*`                                          | `app_discover ok`, `discover`                                         |
| Page hydrate        | `GET /app/<site>/<slug>` full manifest                                                                           | `app_open counter`, `open …`                                          |
| MCP tool surface    | all 10 fixed tools in `tools/list`                                                                               | `all 10 fixed tools listed`                                           |
| MCP dynamic tools   | per-action tools appear after `app_open`                                                                         | `dynamic tools project action ids`                                    |
| MCP resources       | `app://session/<id>`, `…/manifest`, `…/hold`, `app://well-known/<origin>`                                        | `resources advertised`, `resource …` ×3                               |
| Action → diff       | `Accept: …diff+json`, JSON Patch ops, `X-APP-Result-Version`                                                     | `app_act inc (diff)`, `act inc --param`                               |
| Action → navigate   | 303 + `Location`/`X-APP-Navigate`, client re-GETs                                                                | `navigate home`, BA flow in `test:agent`                              |
| Watch               | conditional GET 304/200 (`If-None-Match`), poll mode                                                             | `app_watch poll`, `watch --once`                                      |
| Async ops           | 202 + `operation_status.status_url`, poll until succeeded                                                        | `app_act async wait → succeeded`                                      |
| Challenge (OTP)     | 428 `challenge_required` → hold → `X-APP-Challenge` continuation                                                 | `login → challenge hold`, `app_challenge otp`, `challenge submit otp` |
| Session auth        | challenge completion sets session cookie; `auth:'session'` gates                                                 | `whoami after login`                                                  |
| Consent             | 428/consent hold → `grant_consent` resumes deferred action                                                       | `track → consent hold`, `grant_consent`, `track after grant`          |
| Rate limit          | 429 + `retry_after` surfaced to agent                                                                            | `429 surfaced`                                                        |
| Confirmation        | 428 `confirmation_required` (financial side_effect) → `X-APP-Confirmation` Mode A continue                       | `pay → confirmation hold`, `app_confirm approve`, `confirm --approve` |
| Idempotency         | `X-APP-Idempotency-Key` required + replayed byte-exact                                                           | `mcp-pay-*`/`cli-pay-*` keys, `idem` page                             |
| Soft error          | page-level `error` with soft code (`app.err.partial.results`)                                                    | `open soft`, `soft-error retry clears error`                          |
| Typeahead           | `input.param.options_source` → `act suggest` → results state path                                                | `typeahead suggest → results state`                                   |
| Bulk                | multi-item action, per-row outcomes                                                                              | `bulk_tag`                                                            |
| Delegate            | `kind:'delegate'` + `delegate_protocol:'https'` → hold with `delegates_to`/`resume_url` (agent opens PSP itself) | `delegate → hold kind delegate`, `delegate resume_url page`           |
| Session mgmt        | list / show / gc persisted sessions                                                                              | `app_sessions *`, `sessions list`                                     |
| Logout / reset      | cookie purge + state wipe                                                                                        | `app_logout`, `app_reset`, `logout`, `reset`                          |
| Version negotiation | `X-APP-Accept-Versions: 1.0, 1.1` honored, `app:'1.1'` envelope on 1.1 ops                                       | implicit in every sweep call                                          |
| If-Match version    | `X-APP-If-Match-Version` on all mutations                                                                        | implicit (etag-match required by `inc`)                               |
| CSRF                | `X-APP-Origin` + non-cookie auth enforced by middleware                                                          | implicit in every POST                                                |
| SSE events          | `GET /app-events` (`events_sse` capability), longpoll fallback                                                   | endpoint exercised; extension live-update verified manually           |
| Web-app nodes       | `embed`/`markdown`/`media`/`tree` StateNodes + `gallery`/`calendar`/`stepper` hints (SPEC-WEB-NODES, v1.2)       | `/app/lab/webnodes`, node-semantics vectors, extension components     |

## Deliberately not in the sweeps

- **Mode B uuid confirmation** — rejected locally by design
  (`app.err.action.confirmation_invalid`); refusal itself is the contract.
- **human_verification** — `challenge submit` refuses it by design
  (`app.err.tool.usage`); the lab OTP path covers the challenge machinery.
- **WebAuthn / backup_code** — kind maps to `mfa` hold; no live credential
  flow without a real authenticator.
- **Structured output / policy-strict deny** — client-side flags, covered by
  workspace unit tests rather than the demo wire.
