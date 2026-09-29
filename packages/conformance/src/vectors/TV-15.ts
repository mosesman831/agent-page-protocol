import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv15 } from './runs/index.js';

export const tv15Vector: TestVector = { meta: metaFor(15), run: runTv15 };
