import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv26 } from './runs/index.js';

export const tv26Vector: TestVector = { meta: metaFor(26), run: runTv26 };
