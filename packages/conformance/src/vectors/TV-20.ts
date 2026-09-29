import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv20 } from './runs/index.js';

export const tv20Vector: TestVector = { meta: metaFor(20), run: runTv20 };
