import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv151 } from './runs/index.js';

export const tv151Vector: TestVector = { meta: metaFor(151), run: runTv151 };
