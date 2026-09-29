/**
 * Conformance vector types — SPEC §19.3.
 */

export type ConformanceLevel =
  'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'client';

export interface VectorMeta {
  /** Stable id matching spec table, e.g. `TV-01`. */
  id: string;
  /** Spec ordering 1–140. */
  number: number;
  name: string;
  description: string;
  /** Spec section reference. */
  specRef: string;
  /** Cumulative conformance levels this vector belongs to. */
  levels: ConformanceLevel[];
}

export interface VectorResult {
  vectorId: string;
  passed: boolean;
  message?: string;
  details?: unknown;
  /** True when implementation is incomplete pending server/client APIs. */
  stubbed?: boolean;
}

export interface VectorContext {
  /** Base URL of the ephemeral conformance server (no trailing slash). */
  baseUrl: string;
  /** Page origin for CSRF (scheme://host:port). */
  origin: string;
  fetch: typeof globalThis.fetch;
}

export interface TestVector {
  meta: VectorMeta;
  run: (ctx: VectorContext) => Promise<VectorResult>;
}

export function pass(vectorId: string, message?: string, details?: unknown): VectorResult {
  return { vectorId, passed: true, message, details };
}

export function fail(vectorId: string, message: string, details?: unknown): VectorResult {
  return { vectorId, passed: false, message, details };
}

export function stub(vectorId: string, message: string, details?: unknown): VectorResult {
  return { vectorId, passed: true, stubbed: true, message, details };
}
