import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv158 } from './runs/index.js';

export const tv158Vector: TestVector = { meta: metaFor(158), run: runTv158 };
