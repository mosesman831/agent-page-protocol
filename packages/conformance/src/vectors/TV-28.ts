import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv28 } from './runs/index.js';

export const tv28Vector: TestVector = { meta: metaFor(28), run: runTv28 };
