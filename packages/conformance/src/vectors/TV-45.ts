import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv45 } from './runs/index.js';

export const tv45Vector: TestVector = { meta: metaFor(45), run: runTv45 };
