/**
 * Conformance vector runner.
 */

import { startConformanceServer, type ConformanceServer } from './server.js';
import {
  ALL_VECTORS,
  type TestVector,
  type VectorContext,
  type VectorResult,
} from './vectors/index.js';

export interface RunOptions {
  /** Subset of vector ids to run. Default: all. */
  vectorIds?: string[];
  /** Existing server; if omitted a new ephemeral server is started. */
  server?: ConformanceServer;
  /** Reset server state between vectors (default true). */
  resetBetween?: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  results: VectorResult[];
  baseUrl: string;
}

function selectVectors(ids?: string[]): TestVector[] {
  if (!ids || ids.length === 0) return ALL_VECTORS;
  const set = new Set(ids);
  const selected = ALL_VECTORS.filter((v) => set.has(v.meta.id));
  const missing = ids.filter((id) => !selected.some((v) => v.meta.id === id));
  if (missing.length) {
    throw new Error(`Unknown vector ids: ${missing.join(', ')}`);
  }
  return selected;
}

/**
 * Run conformance vectors against an ephemeral (or provided) test server.
 */
export async function runVectors(options: RunOptions = {}): Promise<RunSummary> {
  const owned = !options.server;
  const server = options.server ?? (await startConformanceServer());
  const resetBetween = options.resetBetween !== false;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const vectors = selectVectors(options.vectorIds);

  const ctx: VectorContext = {
    baseUrl: server.baseUrl,
    origin: server.origin,
    fetch: fetchFn,
  };

  const results: VectorResult[] = [];
  try {
    for (const vector of vectors) {
      if (resetBetween) {
        server.state.reset(server.port);
      }
      const result = await vector.run(ctx);
      results.push(result);
    }
  } finally {
    if (owned) {
      await server.close();
    }
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    baseUrl: server.baseUrl,
  };
}

/** Run a single vector by id. */
export async function runVector(
  id: string,
  options: Omit<RunOptions, 'vectorIds'> = {},
): Promise<VectorResult> {
  const summary = await runVectors({ ...options, vectorIds: [id] });
  return summary.results[0]!;
}
