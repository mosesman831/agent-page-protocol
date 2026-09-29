import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv08 } from './runs/index.js';

export const tv08Vector: TestVector = { meta: metaFor(8), run: runTv08 };
