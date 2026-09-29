import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv39 } from './runs/index.js';

export const tv39Vector: TestVector = { meta: metaFor(39), run: runTv39 };
