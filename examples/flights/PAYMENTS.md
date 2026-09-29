# Payments — day-of checklist

Do these in `examples/flights` on branch `hackathon/payment-seam`. Stop on the first failure and read the UNVERIFIED mark before changing code.

1. `git status` clean of secrets. Confirm `.env` is untracked.
2. Stripe Dashboard → test mode → Developers → API keys. Copy the secret key (`sk_test_...`) into the shell only: `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → Add endpoint. URL: `https://<public-host>/webhooks/payment`. Events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed` (UNVERIFIED event names, §10.3). Reveal the signing secret (`whsec_...`) → `PAYMENT_WEBHOOK_SECRET`.
4. Supabase → SQL editor → run the DDL below. Copy project URL → `SUPABASE_URL` (no slash). Copy service-role key → `SUPABASE_SERVICE_KEY`. Leave the anon key unused.
5. Export the rest: `PSP_PROVIDER=stripe`, `PSP_BASE_URL=https://api.stripe.com`, `SUPABASE_ORDERS_TABLE=orders`, `PAGE_ORIGIN=https://<public-host>` (same origin as the tunnel, or POST `begin_checkout` returns 403), `PORT=3456`.
6. From `examples/flights`: `npm start`. Log line must not say the dev webhook secret. `GET $PAGE_ORIGIN/orders/ord-demo-unpaid` with `Accept: application/vnd.agent-page+json` returns 200 and `payment_status.value = unpaid`.
7. Confirmed POST `begin_checkout` with `Origin: $PAGE_ORIGIN`. Response `delegates_to` is a `https://checkout.stripe.com/...` URL (UNVERIFIED host). `payment_status.value` is `pending_payment`.
8. Open that URL in a browser. Pay with card `4242 4242 4242 4242`, expiry any future month, CVC any 3 digits, ZIP any (UNVERIFIED that this test card still succeeds in Stripe test mode).
9. Browser lands on `/orders/ord-demo-unpaid/pay/callback?session=cs_...&ok=1`. Body is APP JSON, `payment_status.value = paid`, `order.status = paid`. If the page is an error envelope, the `{CHECKOUT_SESSION_ID}` substitution did not match `extra.session_id` — that is the §10.1 UNVERIFIED check; do not weaken the session compare.
10. Supabase table editor: row `id = ord-demo-unpaid`, `payment_status = paid`, `session_id` matches the callback query. If the row is missing and the manifest is paid, the mirror swallowed an error: check the server log, then RLS (UNVERIFIED: RLS on that table may reject the service key until RLS is disabled or a policy exists). If the row is missing, disable RLS on `public.orders` in the dashboard. No schema migration tool in repo.
11. Stripe will also POST the endpoint. Server log should show a 200. `GET` the order again: still `paid`. A redelivery must not move `paid`.

## Environment

| Var                      | Default                    | Rule                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PSP_PROVIDER`           | `stub`                     | Exactly `stub` or `stripe`. Any other value: process exits 1 at boot with message `PSP_PROVIDER must be stub or stripe`. Unset means `stub`.                                                                                             |
| `PSP_BASE_URL`           | `https://api.stripe.com`   | Stripe adapter origin only. No trailing slash. Stub ignores it. UNVERIFIED live host.                                                                                                                                                    |
| `STRIPE_SECRET_KEY`      | unset                      | Required only when `createSession` runs with `stripe`. Shell only. Never commit.                                                                                                                                                         |
| `PAYMENT_WEBHOOK_SECRET` | `dev-insecure`             | HMAC key. If `PSP_PROVIDER=stripe` and the secret is unset or `dev-insecure`, webhook returns 500 before verify. For Stripe this is the dashboard `whsec_...` value used as the raw string, not base64-decoded (UNVERIFIED).             |
| `SUPABASE_URL`           | unset                      | No trailing slash. Both URL and service key required, else mirror is off.                                                                                                                                                                |
| `SUPABASE_SERVICE_KEY`   | unset                      | `apikey` and `Authorization: Bearer`.                                                                                                                                                                                                    |
| `SUPABASE_ORDERS_TABLE`  | `orders`                   | Path segment. Boot exit 1 unless it matches `^[a-z][a-z0-9_]{0,62}$`.                                                                                                                                                                    |
| `PAGE_ORIGIN`            | `http://localhost:${PORT}` | CSRF for POST actions compares `Origin` to this. Mismatch → 403 `app.err.security.csrf`. GET is not CSRF-checked. Unset does not 403 every request; the default is localhost. Tunnel day-of must set `PAGE_ORIGIN` to the public origin. |

Webhook URL to paste in Stripe: `https://<public-host>/webhooks/payment` (POST). Stub and internal contract body is JSON `{ order_id, status, provider_ref, session_id }` with header `X-Payment-Signature`. When `PSP_PROVIDER=stripe`, a `Stripe-Signature` header (and no `X-Payment-Signature`) is normalized into that event. Stripe field paths are UNVERIFIED.

## Supabase DDL

```sql
create table if not exists public.orders (
  id text primary key,
  payment_status text not null check (payment_status in ('unpaid','pending_payment','paid','failed')),
  order_status text not null,
  session_id text,
  provider_ref text,
  currency text,
  total integer,
  updated_at timestamptz not null default now()
);
```

UNVERIFIED: PostgREST still upserts with `on_conflict=id` plus `Prefer: resolution=merge-duplicates`, and the service role bypasses RLS. UNVERIFIED: RLS on that table may reject the service key until RLS is disabled or a policy exists.

## UNVERIFIED Stripe checkout (do not “fix” from memory)

- `POST ${PSP_BASE_URL}/v1/checkout/sessions` form fields: `mode=payment`, `success_url` / `cancel_url` containing the literal `{CHECKOUT_SESSION_ID}`, `client_reference_id`, `metadata[order_id]`, `line_items[0][quantity]=1`, `line_items[0][price_data][currency]` lowercase, `line_items[0][price_data][unit_amount]` integer minor units, `line_items[0][price_data][product_data][name]`.
- UNVERIFIED: Stripe still substitutes the literal `{CHECKOUT_SESSION_ID}` in `success_url` / `cancel_url`; currency must be lowercase; `unit_amount` is integer minor units; `mode=payment` is valid without a Price id.
- Response uses only `id` and `url`. UNVERIFIED that those two fields still exist on a Checkout Session create response.
- UNVERIFIED: Stripe still signs `t + "." + body` with HMAC-SHA256 hex, and the dashboard secret is the HMAC key as stored (not base64-decoded).
- UNVERIFIED event type paths: `type`, `data.object.id`, `data.object.metadata.order_id` else `data.object.client_reference_id`, `data.object.payment_intent` if string else `data.object.id`, paid when `type === checkout.session.completed` and `data.object.payment_status === paid`, failed when `type` is `checkout.session.expired` or `checkout.session.async_payment_failed`.
- UNVERIFIED host `https://checkout.stripe.com/...` on `delegates_to`.
- UNVERIFIED that card `4242 4242 4242 4242` still succeeds in Stripe test mode.

Limitations: no live Stripe call is made by the tests; no live Supabase call is made by the tests; `paid` and `failed` are terminal so a late success after `failed` stays `failed`; the stock client does not auto-open a dynamic `delegates_to` (read it from the action 200 body).
