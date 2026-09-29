import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv18 } from './runs/index.js';

export const tv18Vector: TestVector = { meta: metaFor(18), run: runTv18 };
