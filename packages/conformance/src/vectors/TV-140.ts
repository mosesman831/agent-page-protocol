import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv140 } from './runs/v11.js';

export const tv140Vector: TestVector = { meta: metaFor(140), run: runTv140 };

const vitest = (
  import.meta as ImportMeta & {
    vitest?: {
      describe: (name: string, fn: () => void) => void;
      it: (name: string, fn: () => Promise<void>) => void;
      expect: (value: unknown, message?: string) => { toBe: (v: unknown) => void };
    };
  }
).vitest;

if (vitest) {
  const { describe, it, expect } = vitest;
  describe('TV-140 standalone', () => {
    it('Localized message, stable code', async () => {
      const { startConformanceServer } = await import('../server.js');
      const server = await startConformanceServer();
      try {
        server.state.reset(server.port);
        const result = await tv140Vector.run({
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
