import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv24 } from './runs/index.js';

export const tv24Vector: TestVector = { meta: metaFor(24), run: runTv24 };
