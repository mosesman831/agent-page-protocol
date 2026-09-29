import { describe, it, expect } from 'vitest';
import { main } from '../src/main.js';

describe('usage', () => {
  it('--help exits 0 and prints text', async () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array,
    ) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(['--help']);
      expect(code).toBe(0);
      expect(chunks.join('')).toContain('agent-page');
      expect(chunks.join('')).toContain('Commands:');
    } finally {
      process.stdout.write = orig;
    }
  });

  it('unknown command exits 2', async () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array,
    ) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(['not-a-command']);
      expect(code).toBe(2);
      const body = JSON.parse(chunks.join('') || '{}') as {
        error?: { code?: string };
      };
      expect(body.error?.code).toBe('app.err.tool.usage');
    } finally {
      process.stdout.write = orig;
    }
  });
});
