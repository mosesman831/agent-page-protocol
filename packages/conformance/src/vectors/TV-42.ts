import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv42 } from './runs/index.js';

export const tv42Vector: TestVector = { meta: metaFor(42), run: runTv42 };
