import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv150 } from './runs/index.js';

export const tv150Vector: TestVector = { meta: metaFor(150), run: runTv150 };
