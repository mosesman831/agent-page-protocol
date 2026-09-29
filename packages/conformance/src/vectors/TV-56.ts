import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv56 } from './runs/index.js';

export const tv56Vector: TestVector = { meta: metaFor(56), run: runTv56 };
