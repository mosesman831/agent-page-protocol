import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv31 } from './runs/index.js';

export const tv31Vector: TestVector = { meta: metaFor(31), run: runTv31 };
