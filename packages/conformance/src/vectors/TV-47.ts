import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv47 } from './runs/index.js';

export const tv47Vector: TestVector = { meta: metaFor(47), run: runTv47 };
