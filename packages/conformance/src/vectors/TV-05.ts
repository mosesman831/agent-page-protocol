import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv05 } from './runs/index.js';

export const tv05Vector: TestVector = { meta: metaFor(5), run: runTv05 };
