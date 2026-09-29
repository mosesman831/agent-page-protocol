# Renderer skin — handoff requests to the payment/store lane

This branch (`hackathon/renderer-skin`) reskins the renderer only. It does not
modify the store manifest or payment lane; the items below are requests for the
lane that owns `examples/flights/**` / the commerce manifest.

- **H-0** Store manifest should present its product list as `layout: "grid"` (or
  `card`) sections so the renderer emits cards, not a raw table/list. The demo's
  first screen depends on this.
- **H-1** Detail manifests should include `sections` (`layout: "detail"`,
  `state_path` to the record object). Without sections the renderer has to
  synthesise one (W9 fallback); explicit sections are the stable contract.
- **H-2** Image fields should carry absolute `https:` URLs. Committed
  `extension/assets/img/*.jpg` files exist only for the renderer's offline
  harness; a live manifest cannot assume they are reachable on every install.
- **H-3** Store/order data should include a `status` (or `availability`) field
  per product and keep the order node's `status`/`payment.status` current, so
  the skin can show stock/counter-offer/paid chips without guessing.

Implementation notes for that lane: money stays integer minor units + `scale`;
a `currency`/`price_scale` sibling on the page fixes table currency cells
(F-4). No protocol or schema change is needed for any of the above.
