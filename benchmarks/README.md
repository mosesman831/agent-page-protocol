# APP Benchmarks

Reproducible benchmarks comparing the Agent Page Protocol against equivalent HTML, using the **same content** in both representations for a fair comparison.

## Setup

```bash
# 1. Build + run the flights example (agent-native, manifest-only)
cd examples/flights
npm run build
node dist/server.js            # listens on :3456

# 2. Run benchmarks (from repo root, server running)
node benchmarks/run.mjs                        # against localhost:3456
node benchmarks/run.mjs https://your-tunnel.com # against a tunnel/network
```

## What it measures

| Section                             | Metric                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Full booking flow**            | Latency (p50/p95), bytes, token estimate per step across 5 runs: search → results → filter → select → booking → confirm (428 challenge → token) |
| **B. Diff compounding**             | 10 sequential filter diffs vs 10 full manifest re-fetches — quantifies the diff protocol's savings                                              |
| **C. Conditional GET**              | 304 revalidation via ETag — cache savings on repeat visits                                                                                      |
| **D. Same-content HTML comparison** | Same flight data rendered as realistic production HTML (doc + JS + CSS) vs the manifest                                                         |

## Reference results (2026-09-26, v0.4, localhost, Node 24)

Measured run — `node benchmarks/run.mjs` against `examples/flights`:

```
[A] Full booking: 7 round trips, ~1,968 tokens total; step p50s 0.7–1.5 ms
    (flow p50 ≈ 6.6 ms summed)
[B] Diff savings : 88.9% vs full re-fetch — 10 diffs 3,704 B vs 10×3,330 B;
    p50 diff latency 1.3 ms
[C] 304 revalidat: 0 B body, 0.7 ms (ETag present)
[D] Transfer     : HTML+assets 335,606 B vs manifest 3,332 B → ~100.7x bigger.
    Doc-only tokens ~891 (HTML) vs ~833 (manifest) — parity on the document
    itself; the win is the total payload, not token count.
```

Honest reading: on a small page the manifest is ~parity on raw doc tokens —
the measured wins are ~100× transfer, ~89% diff savings, 0-byte
revalidation, single-digit-ms latency, and 7 typed round trips vs 40+ DOM
interactions on a real site.

## Methodology notes

- **Fairness:** both representations carry the _same_ flights, prices, filter form, and book actions. Not APP vs a third-party site.
- **Token estimate:** `chars/4` heuristic, the standard LLM token approximation. Rendered-DOM parsing for HTML is estimated at ~2x source size (agents parse the live DOM, not just source).
- **Real sites skew further in APP's favor:** production flight sites ship 100KB-2MB pages with heavier JS, ads, and trackers (transfer ratio 300-1000x), and agents need 40+ interactions vs APP's 7.
- **The non-numeric win:** APP values are typed (`price = {type:number, value:84500, scale:2, unit:GBP}`) and actions are declared with schemas — an agent needs zero inference. HTML requires reverse-engineering which `<td>` is the price and what `applyFilters()` does.
- **Confirm flow:** financial actions require auth + a 428 confirmation challenge (SHA-256 body-bound token). A 401 on the final confirm without a session is the security model working, not a failure.

## Files

- `run.mjs` — the benchmark runner (Node, no deps)
- this file — methodology + reference results
