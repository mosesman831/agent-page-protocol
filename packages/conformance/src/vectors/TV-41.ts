import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv41 } from './runs/index.js';

export const tv41Vector: TestVector = { meta: metaFor(41), run: runTv41 };
