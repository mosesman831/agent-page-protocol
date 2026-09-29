import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv61 } from './runs/v11.js';

export const tv61Vector: TestVector = { meta: metaFor(61), run: runTv61 };

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
  describe('TV-61 standalone', () => {
    it('Feature object present, 1.1 selected', async () => {
      const { startConformanceServer } = await import('../server.js');
      const server = await startConformanceServer();
      try {
        server.state.reset(server.port);
        const result = await tv61Vector.run({
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
