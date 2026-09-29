import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv33 } from './runs/index.js';

export const tv33Vector: TestVector = { meta: metaFor(33), run: runTv33 };
