import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv25 } from './runs/index.js';

export const tv25Vector: TestVector = { meta: metaFor(25), run: runTv25 };
