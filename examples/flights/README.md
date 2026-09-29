# Acme Flights - APP 1.1 dual-speak example

End-to-end flight booking demo for the [Agent Page Protocol](../../SPEC-v0.5-extreme.md). The v0.4 search / filter / select_flight / confirm_booking path is unchanged so CLIENT-TOOL-CONTRACT §13 still passes. 1.1 features are additive.

## Run

```bash
cd examples/flights
npm install
npm start          # builds then serves on http://localhost:3456
# or
npm run dev        # tsx watch
```

Override port / origin:

```bash
PORT=3456 PAGE_ORIGIN=http://localhost:3456 npm start
```

Binds `0.0.0.0`. Default page origin: `http://localhost:3456`.

## Happy path (v0.4)

1. `GET /.well-known/agent-page` - site manifest (`booking`, `async_actions`, `pagination`, ...)
2. `GET /flights` - search form
3. `POST` `search` -> **303** + `Location` + `X-APP-Navigate` (empty body) to `/flights/{origin}/{destination}/{date}?pax=`
4. `GET` results - `table` StateNode; `price` column = integer minor units; companion `currency` / `price_scale`
5. `POST` `filter` -> Diff Document (`requires_etag_match`)
6. `POST` `select_flight` -> **303** navigate to `/booking/{flight_id}`
7. `GET` booking - `selected_price` number node (`scale:2`, `unit:"GBP"`); `confirm.amount_path: "selected_price"`
8. `POST` `confirm_booking` without confirmation -> **428** (SHA-256 body binding challenge; requires `X-APP-Idempotency-Key` + `X-APP-If-Match-Version`)
9. `POST` identical bytes + `X-APP-Confirmation` -> **202 Form D** (`operation_status`, `meta.poll_interval_ms`)
10. `GET /operations/{jobId}` - advances `queued` -> `running` -> `succeeded` (optional `cancel_operation` while in flight)
11. Booking page reflects confirmed PNR + confirmation code

Money uses integer minor units with `scale=2` (e.g. `64000` = £640.00). Floats are never used for money.

Agent-native: `Accept: text/html` → **406**; only `application/vnd.agent-page+json` is served.

## v0.4 behaviors

| Behavior      | Wire                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| Navigate      | `303` + `Location` + `X-APP-Navigate`; empty body (no 200 redirect manifest) |
| Concurrency   | `page.version` only (no root `page_version`); ETag is cache-only             |
| Async booking | Form D `202` + poll `status_url`; capability `async_actions`                 |
| Confirmation  | Mode A challenge; binding = SHA-256 over **exact** request body bytes        |
| Money         | Integer minor units + `scale` / `unit` on number nodes                       |

## Dual-speak (1.0 vs 1.1)

Send `X-APP-Accept-Versions: 1.1, 1.0` (and optionally `X-APP-Version: 1.1`) to select 1.1. The well-known document then has `app: "1.1"`, `state.protocol_version: "1.1"`, `state.features` (booleans), `state.flows`, `state.privacy`, and `state.events_url`.

Send `X-APP-Accept-Versions: 1.0` (or omit both version headers) to select 1.0. The body keeps `app: "1.0"`, projects `type:order` to an object, and strips 1.1 ActionDef keys (`options_source`, `policy.consent_purposes`, `policy.step_up`, `bulk`, `meta.flow`). `state.features` is still an object of boolean StateNodes so 1.1 clients can detect flags even if `X-APP-Version` is `1.0`.

## 1.1 routes

Identity, MFA, consent, commerce, events, and typeahead are additive. Demo secrets only:

| Route                           | What                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /login`                    | Password login. Demo `user@example.com` / `correct-horse`. Tokens only in `X-APP-Access-Token` / `Set-APP-Resume` / `Set-Cookie`, never JSON. |
| `GET /logout`                   | `logout` action (identity).                                                                                                                   |
| `GET /mfa`                      | Page-step OTP after `mfa@example.com` / `correct-horse`. OTP `123456`.                                                                        |
| `GET /consent`                  | `grant_consent` plus `subscribe_alerts` gated on `analytics`.                                                                                 |
| `GET /holds/{id}`               | TOS hold issued by `join_loyalty` (`428 app.err.hold.human_required`).                                                                        |
| `GET /orders/ord-demo-unpaid`   | Order node (`awaiting_payment`). `start_pay` -> `/orders/{id}/pay`.                                                                           |
| `GET /orders/ord-demo-cancel`   | `cancel_pending`. `resolve_cancel` `to` in `cancelled` \| `awaiting_payment` \| `fulfilling` only.                                            |
| `GET /orders/{id}/pay`          | 3-D Secure start (`pay_redirect` delegate + `complete_payment`).                                                                              |
| `GET /orders/{id}/3ds-callback` | Same-origin PSP return (GET binds a slot; no tokens in the body).                                                                             |
| `GET /app-events`               | SSE (`Accept: text/event-stream`) or long-poll (`mode=longpoll`).                                                                             |

Identity / financial / destructive POSTs still require `X-APP-Idempotency-Key` and may `428` Mode A confirmation (same as `confirm_booking`).

## Notes

- Depends on `@agent-page/server` via `file:../../packages/server`.
- Raw POST bodies are captured (`express.json` `verify`) so confirmation fingerprints match C10.
- No extra npm packages. Loopback HTTP is fine. `PAGE_ORIGIN` is the CSRF origin (use the tunnel URL when not on localhost).
