import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/vectors/TV-61.ts', 'src/vectors/TV-140.ts'],
    includeSource: ['src/vectors/TV-61.ts', 'src/vectors/TV-140.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
