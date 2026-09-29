import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv07 } from './runs/index.js';

export const tv07Vector: TestVector = { meta: metaFor(7), run: runTv07 };
