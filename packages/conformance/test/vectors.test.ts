import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  ALL_VECTORS,
  VECTOR_METADATA,
  runVectors,
} from '../src/index.js';

describe('SPEC §19.3 / §27 conformance vectors (TV-01..TV-158)', () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    server = await startConformanceServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.state.reset(server.port);
  });

  it('exports metadata for all 158 required vectors', () => {
    expect(VECTOR_METADATA).toHaveLength(158);
    expect(ALL_VECTORS).toHaveLength(158);
    expect(VECTOR_METADATA.map((m) => m.id)).toEqual(
      Array.from({ length: 158 }, (_, i) => `TV-${String(i + 1).padStart(2, '0')}`),
    );
    expect(VECTOR_METADATA.map((m) => m.number)).toEqual(
      Array.from({ length: 158 }, (_, i) => i + 1),
    );
  });

  for (const vector of ALL_VECTORS) {
    it(`#${vector.meta.number} ${vector.meta.id}: ${vector.meta.name}`, async () => {
      server.state.reset(server.port);
      const result = await vector.run({
        baseUrl: server.baseUrl,
        origin: server.origin,
        fetch: globalThis.fetch,
      });
      expect(result.passed, result.message).toBe(true);
    });
  }

  it('runVectors() executes the full suite', async () => {
    const summary = await runVectors({ server, resetBetween: true });
    expect(summary.total).toBe(158);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(158);
  });
});
