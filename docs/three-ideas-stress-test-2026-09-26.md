# Product Idea Stress Tests — Team Handoff

**For:** teammate agents and humans (Riyansh, Jack, Remy)  
**Date:** 2026-09-26 (Europe/London)  
**Context:** Grok Bot Commerce London hackathon (single-day build). APP is largely pre-built; day-of delta is mainly payments + negotiation demo + Grok Bot integration + renderer polish.  
**Purpose:** Decide how much _additional_ time, money, and attention each idea deserves _after_ the hackathon — not whether today’s demo is clever.

**Evidence grades:** A behavioural / primary verified · B strong primary · C corroborating · D proxy · E assertion / team claim. Never treat D/E as validation.

---

## Decision frame

| Constraint                          | Implication                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Single-day project                  | Do not evaluate “build cost from zero.” Evaluate _post-hackathon capital allocation_.                                  |
| APP mostly pre-built (not payments) | Protocol depth is a sunk cost. Sunk cost ≠ reason to keep investing. Ask: does more work change the Bottleneck Belief? |
| Two investors on judging panel      | Demo can win prizes without proving a company. Keep prize vs company decisions separate.                               |

**Optimise for:** (1) decision usefulness (2) evidence quality (3) bottleneck uncertainty (4) speed of learning (5) completeness.

---

## Executive comparison

| Idea                                                           | Job that is real?                                      | Company thesis strength                                                                       | Best post-hackathon move                                                                      | Capital allocation                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. APP (open agent commerce protocol)**                      | Yes — agents need structured commerce without scraping | Weak as venture-scale _protocol company_; fair as UCP bridge / tooling / long-tail plugin     | Test whether any major agent surface will fetch merchant-hosted manifests without Catalog/UCP | **Park as competing standard.** Ship demo. Open-source or bridge to UCP if continuing. Do not spend months evangelising a second `/.well-known`. |
| **2. Consumer catalogue (compare / deals / price track)**      | Yes — durable price-sensitive behaviour                | Weak as horizontal Honey/Idealo clone; fair as sharp niche or data layer feeding agents       | Only continue if there is a defined wedge (category × geography × proprietary data)           | **Do not build as primary company** after today unless wedge is explicit. Otherwise distraction from protocol/demo.                              |
| **3. Agentic trading / investing (“Claude Code for trading”)** | Research demand real; autonomous execution niche       | Weak as standalone consumer agent brand in 2026; fair as B2B infra or regulated advice (slow) | Do not pursue from this hackathon                                                             | **Defer entirely.** Wrong regulatory DNA for a commerce hackathon side product.                                                                  |

**Team recommendation (post-hackathon):** Finish the demo. Treat prize outcome as orthogonal. Default: **do not spin APP into a multi-month protocol company** without falsifying the Bottleneck Belief below. Do not start catalogue or trading as parallel companies from this weekend.

---

## 1. Agent Page Protocol (APP)

### Thesis

An open protocol where the storefront **is** a machine-transactable document (`/.well-known/agent-page` JSON: products, price, state, actions). Agents walk a state machine instead of scraping HTML. Humans render the same manifest. Claimed contrast vs UCP / Storefront MCP: those are RPC endpoints requiring per-merchant agent integrations; APP is page-native.

### What has to be true

1. Agents need structured, trustworthy commerce data (supported).
2. Page-as-document is meaningfully better than well-known discovery + session endpoints (contested).
3. Enough merchants publish APP without platforms doing it for them (weak).
4. Major agent runtimes fetch APP as a primary path (unproven).
5. Someone pays the protocol company (historically hard).

### Evidence for

- Scraping fails for live price/inventory/shipping/fraud (C–B).
- Shopify: AI-driven traffic ~8× YoY, AI-search orders ~13× Q1 2026 (B, vendor). Discovery demand real.
- WebMCP (Chrome origin trial) validates page-native agent tools as an industry direction (A).
- Long-tail / non-Shopify shops may want a permissionless publish path (B logical).

### Evidence against

- **UCP (Google + Shopify, Jan 2026)** already uses `/.well-known/ucp`, capability negotiation, checkout state machine, HITL escalation. Open Apache-2.0. Endorsers include major retailers and PSPs (A/B). Docs: https://ucp.dev
- **Shopify Agentic Storefronts:** default-on for eligible merchants — **zero** per-merchant agent integration. Pitch claim “every merchant must integrate every agent” is **overstated** for the largest merchant base (B).
- **Storefront MCP deprecated into UCP** (A — Shopify migrate docs).
- **Open Commerce Protocol** is a near-twin (`/.well-known/ocp.json` + products feed, bridges to UCP/MCP/ACP) (B/C). https://opencommerceprotocol.org/
- Agent-native checkout demand weak: Instant Checkout underperformed; OpenAI winding it down toward merchant-owned checkout/apps (C). Discovery stays; autonomous purchase ownership contested.
- Protocol monetisation trap: value accrues to platforms and PSPs (logical + historical).
- Team metrics (3.4KB vs 337KB, token counts, 435+ tests): **E** until third-party repro. Fine for demo; not validation.

### Bottleneck Belief

**Will any major agent runtime (or buyer surface with real traffic) fetch merchant-hosted APP documents as a primary path — or will almost all agent GMV go through platform Catalogs + UCP/ACP?**

If platforms win that path, APP-as-competing-OS is dead even if engineering is excellent.

### Highest-information next experiment (1–2 weeks, only if continuing)

1. Ask 10–20 agent/buyer surfaces and merchants: “If a merchant publishes only `/.well-known/agent-page` (or OCP), with no UCP/Catalog, will you discover and check out?”
2. Success: ≥2 surfaces with real users say yes in writing, _or_ a live APP merchant gets unpaid organic agent hits in 30 days.
3. Falsifier: everyone says use UCP / Catalog / Merchant Center → stop competing on protocol; bridge to UCP or walk away.

### Capital allocation

**Do not treat APP as a venture-scale protocol company on current evidence.**  
**Allowed:** finish hackathon; open-source interesting bits; reposition as **UCP/WebMCP bridge + tooling** for long-tail merchants; or sell HITL/payments/security middleware that speaks UCP _and_ APP.  
**Not allowed (without Bottleneck Belief test):** months of standards evangelism, second competing `/.well-known` war with Google/Shopify.

### Stronger adjacent thesis

Own a thin vertical where agents already fail (configurable goods, B2B quotes, travel) and speak **UCP** (optionally with a page profile), rather than replacing UCP.

### Hackathon note

Day-of delta (negotiation, Stripe payment seam, Supabase orders, Grok Bot two-bot thread, renderer) is the honest “what we built today” story. Pre-built protocol depth is fine to disclose; do not claim it was written in the window.

---

## 2. Consumer catalogue (compare / deals / price changes)

### Thesis

A consumer frontend: product catalogue, comparison, deals, price-change tracking, related catalogue features — as a standalone consumer product (not merely APP’s human view).

### What has to be true

1. People repeatedly compare prices and hunt deals (supported).
2. A _new_ destination UI can acquire users against Google Shopping / Gemini / ChatGPT shopping / Honey-class extensions (weak).
3. Offer coverage + matching quality is good enough to trust (expensive).
4. Merchants or affiliates pay enough after attribution wars and Chrome policy risk (fragile).

### Evidence for

- Job-to-be-done is durable: idealo 2024 revenue €257M; Google investing in price insights + agentic checkout; grocery/deal surveys show high price sensitivity (A–C).
- Monetisation path exists without consumer subscription: affiliate + CPC (A).
- Exit comps: Honey ~$4B (PayPal), PriceRunner ~$124M (Klarna) (A/B).
- Honey trust scandal (Chrome users ~20M → ~15M by May 2025; litigation) creates a window for cleaner attribution (B).

### Evidence against

- **Distribution is destiny.** Google Shopping Graph (>50B listings, ~2B updates/hour) + AI Mode/Gemini ship compare + track + buy. ChatGPT shopping absorbs discovery (A/B).
- Winners are distribution giants, payments attach (Honey, Capital One Shopping, Klarna), regional CSEs (idealo), or Amazon-data specialists (Keepa/CamelCamelCamel) — not pure greenfield frontends (A/B).
- Data moat brutal: SKU matching, shipping-inclusive totals, stock, merchant feeds. Scraping is ToS-fragile (B/C).
- Affiliate last-click model is politically and platform-risk fragile post-Honey (A/B).
- As a _standalone_ horizontal product, this is a crowded low-moat consumer play — and a distraction if the real asset is APP.

### Bottleneck Belief

**Can you get complete-enough offers in one geography × category, with a distribution channel that is not “hope users leave Google,” at positive contribution margin after affiliate/CPC reality?**

### Highest-information next experiment (only if pursuing)

Do **not** build a full catalogue. Pick one wedge (e.g. UK electronics, or one marketplace’s price history for power users). Measure: (a) weekly active searchers from a non-paid channel, (b) clickout CVR vs Google for same query set, (c) affiliate yield after cookie conflicts. Kill if (a) or (b) fails in 4 weeks of concierge/manual data.

### Capital allocation

**Do not make this the post-hackathon company** unless a wedge is named and the Bottleneck Belief test is scheduled.  
**Allowed:** human renderer as _demo surface_ for APP (already in plan).  
**Not allowed:** parallel “we’re also building the next Honey” without data/distribution plan.

### Stronger adjacent thesis

Be the **data/protocol layer** agents and CSEs call (feeds, matching, price history API) — Keepa-like B2B — or a regional/category CSE with merchant contracts. Not another generic compare UI.

---

## 3. Agentic trading / investing (“Claude / Claude Code for commercial trading”)

### Thesis

An agentic product like Claude Code, but for investing/trading — agents that make it easier to invest and trade.

### What has to be true

1. Users want AI help with investing (supported for _research_).
2. They will use a _standalone_ agent brand rather than free Claude/ChatGPT plugged into Robinhood/IBKR/Webull MCP, or in-app agents (Public, SoFi Composer) (weak in 2026).
3. Product can ship valuable personalisation without triggering advice/RIA rules — or founders will get licensed (expensive).
4. Someone pays (retail SaaS weak; brokers/RIA B2B more plausible).

### Evidence for

- Research adoption high (e.g. Investing.com survey Apr 2026: ~62% used AI for investment decisions — B, selection bias).
- UK advice gap ~23M; FCA “targeted support” regime live Apr 2026 — real problem + regulatory opening for _authorised_ firms (A).
- Technical readiness proven by broker launches 2026 (A).

### Evidence against

- **By mid-2026, major US brokers already shipped agentic trading** (Public Agents, Robinhood Agentic Trading / BYO agent, IBKR + Claude/ChatGPT/Grok, Webull, SoFi Composer, Alpaca MCP, etc.) (A).
- Claude Code analogy **breaks** on money: irreversible loss, tax, margin; liability sits on the firm; AI cannot be the fiduciary (A/C).
- Personalisation that makes the product valuable is what triggers **FCA advice perimeter / US Advisers Act** (A). Unlicensed “you should buy X given your portfolio” is high risk regardless of disclaimers.
- SEC AI-washing enforcement already live (Delphia, Global Predictions — A).
- Monetisation: brokers give agent features away for retention; pure research chat competes with ChatGPT Plus (B/E).
- Commerce protocol DNA does **not** transfer to securities compliance.

### Bottleneck Belief

**Is there a paying wedge that brokers will not ship for free inside custody — and that you can legally deliver without becoming an RIA/broker first?**

If no, standalone consumer thesis is dead.

### Highest-information next experiment

**Do not build.** If curiosity remains after hackathon: 10 interviews with active retail traders _and_ one compliance read (FCA PERG / US Advisers Act three-part test) on your exact intended UX. Kill if (a) users say they’d only use it inside their existing broker, or (b) intended UX is advice without a license plan.

### Capital allocation

**Defer entirely post-hackathon.** Wrong problem domain for this team’s current asset (APP) and for a weekend commerce build.  
**If ever revisited:** B2B agent governance/MCP safety for brokers/RIAs, or UK authorised targeted-support product — not an unlicensed consumer “AI money manager.”

### Stronger adjacent thesis

Sell **agent policy, audit trails, and HITL gates** to firms that already hold money — not a consumer Claude-for-trading brand.

---

## Cross-cutting: what teammates’ agents should not do

1. Do not treat hackathon judging success as company validation.
2. Do not treat team-claimed APP perf numbers as Grade A evidence.
3. Do not start catalogue or trading workstreams that steal Device 1–3 lanes during the hackathon.
4. Do not invent strategic pivots mid-demo; surface them only after code freeze.
5. If asked “should we raise / keep building APP as a protocol company?” — answer with the Bottleneck Belief test, not more features.

---

## Suggested next actions (human owners)

| When                   | Who                             | Action                                                                                        |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| Today                  | Remy / all                      | Ship demo per handoff; honest day-of delta story                                              |
| Day after              | Jack (or whoever owns strategy) | Decide: park APP competing-standard thesis vs schedule Bottleneck Belief outreach (1–2 weeks) |
| Only if continuing APP | Anyone                          | 20-question distribution test (section 1 experiment); no new protocol surface until results   |
| Catalogue / trading    | —                               | No work unless explicit wedge + owner + experiment date                                       |

---

## Key primary links (agents: prefer these over summaries)

**Agent commerce / APP competitors**

- UCP: https://ucp.dev · https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/ · https://shopify.engineering/UCP
- Shopify agentic: https://www.shopify.com/news/agentic-commerce-momentum · https://www.shopify.com/blog/how-agentic-commerce-works
- ACP: https://www.agenticcommerce.dev/
- OCP (closest APP twin): https://opencommerceprotocol.org/
- WebMCP: https://developer.chrome.com/docs/ai/webmcp
- Instant Checkout stumble: https://www.cnbc.com/2026/03/20/open-ai-agentic-shopping-etsy-shopify-walmart-amazon.html

**Catalogue / deals**

- Google Shopping / agentic checkout: https://blog.google/products-and-platforms/products/shopping/agentic-checkout-holiday-ai-shopping/
- Honey Chrome decline: https://9to5google.com/2025/05/23/honey-15-million-chrome-users-six-months/

**Trading / investing agents**

- Public Agents: https://public.com/ai-agents
- Robinhood Agentic: https://robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents/
- FCA AI + InvestSmart: https://www.fca.org.uk/investsmart/using-ai-investment-research
- FCA targeted support PS25/22: https://www.fca.org.uk/publications/policy-statements/ps25-22-consumer-pensions-investment-decisions-rules-targeted-support

---

## Source note for agents

This file was produced by Product Idea Stress Test for Jack Moss on 2026-09-26 from: (1) team hackathon handoff on APP, (2) founder clarification that APP is mostly pre-built except payments and this is a single-day project, (3) public-web evidence passes on UCP/Shopify/ACP/OCP, consumer CSE/deal apps, and 2026 broker agentic trading + UK/US regulatory perimeter. Re-verify primary URLs before citing numbers externally; vendor metrics remain Grade B.
