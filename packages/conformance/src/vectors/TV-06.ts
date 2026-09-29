import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv06 } from './runs/index.js';

export const tv06Vector: TestVector = { meta: metaFor(6), run: runTv06 };
