/**
 * When vitest is invoked on a single TV-*.ts file, run that vector against
 * an ephemeral conformance server.
 */

import type { TestVector } from './types.js';

export function attachStandalone(vector: TestVector): void {
  const file = `${vector.meta.id}.ts`;
  const direct = process.argv.some((arg) => {
    const n = arg.replace(/\\/g, '/');
    return n.endsWith(`/vectors/${file}`) || n.endsWith(file);
  });
  const vitest = (
    import.meta as ImportMeta & {
      vitest?: {
        describe: (name: string, fn: () => void) => void;
        it: (name: string, fn: () => Promise<void>) => void;
        expect: (value: unknown, message?: string) => { toBe: (v: unknown) => void };
      };
    }
  ).vitest;
  if (!direct || !vitest) return;
  const { describe, it, expect } = vitest;
  describe(`${vector.meta.id} standalone`, () => {
    it(vector.meta.name, async () => {
      const { startConformanceServer } = await import('../server.js');
      const server = await startConformanceServer();
      try {
        server.state.reset(server.port);
        const result = await vector.run({
          baseUrl: server.baseUrl,
          origin: server.origin,
          fetch: globalThis.fetch,
        });
        expect(result.passed, result.message).toBe(true);
      } finally {
        await server.close();
      }
    });
  });
}
