import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv21 } from './runs/index.js';

export const tv21Vector: TestVector = { meta: metaFor(21), run: runTv21 };
