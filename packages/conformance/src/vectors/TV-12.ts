import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv12 } from './runs/index.js';

export const tv12Vector: TestVector = { meta: metaFor(12), run: runTv12 };
