import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv10 } from './runs/index.js';

export const tv10Vector: TestVector = { meta: metaFor(10), run: runTv10 };
