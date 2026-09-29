import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv38 } from './runs/index.js';

export const tv38Vector: TestVector = { meta: metaFor(38), run: runTv38 };
