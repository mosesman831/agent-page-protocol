# @agent-page/conformance

Conformance test suite for the Agent Page Protocol (APP) — **SPEC §19.3 Test Vectors**.

Uses the reference server (`@agent-page/server`) on an ephemeral port.

## Vectors (§19.3)

| #   | Id                    | Scenario                                                                                                                                |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `empty-state`         | Empty state `{}` with zero actions                                                                                                      |
| 2   | `null-nodes`          | Explicit `type: "null"` nodes inside objects                                                                                            |
| 3   | `empty-arrays`        | Empty array / table values                                                                                                              |
| 4   | `enum-validation`     | Invalid enum param → `400 app.err.validation.param_enum`                                                                                |
| 5   | `diff-array-root`     | Diff replace of array root                                                                                                              |
| 6   | `diff-conflict`       | Stale version → `409`; re-GET + retry                                                                                                   |
| 7   | `navigate-unicode`    | URL template encoding with unicode                                                                                                      |
| 8   | `rate-limit`          | `429` + `Retry-After`                                                                                                                   |
| 9   | `financial-confirm`   | Financial action `428` → `200`                                                                                                          |
| 10  | `soft-error`          | Soft error + partial results on HTTP 200                                                                                                |
| 11  | `auth-refresh`        | `401` → refresh once → success; failed refresh surfaces                                                                                 |
| 12  | `idempotency`         | Same key+body byte-equal; different body → `409`                                                                                        |
| 13  | `confirmation-replay` | Confirmation + mutated params → `403`                                                                                                   |
| 14  | `csrf-precedence`     | Mismatched `Origin` wins over valid `X-APP-Origin` → `403`                                                                              |
| —   | `inversion-guardrail` | Agent-native: `Accept: text/html` → `406`; first-party `X-APP-Origin`+Bearer OK; `chrome-extension://` Origin → `403`; no HTML artifact |

## Run

```bash
# from monorepo root
npm install
npm test -w @agent-page/conformance

# or
cd packages/conformance && npm test
```

## Programmatic use

```ts
import { VECTOR_METADATA, runVectors, startConformanceServer } from '@agent-page/conformance';

const summary = await runVectors();
console.log(summary.passed, '/', summary.total);
```

`VECTOR_METADATA` is exported for external runners.
