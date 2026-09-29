import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv11 } from './runs/index.js';

export const tv11Vector: TestVector = { meta: metaFor(11), run: runTv11 };
