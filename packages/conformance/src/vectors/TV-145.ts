import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv145 } from './runs/index.js';

export const tv145Vector: TestVector = { meta: metaFor(145), run: runTv145 };
