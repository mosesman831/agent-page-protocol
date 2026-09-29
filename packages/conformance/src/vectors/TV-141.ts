import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv141 } from './runs/index.js';

export const tv141Vector: TestVector = { meta: metaFor(141), run: runTv141 };
