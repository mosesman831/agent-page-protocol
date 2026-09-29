import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv27 } from './runs/index.js';

export const tv27Vector: TestVector = { meta: metaFor(27), run: runTv27 };
