import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv58 } from './runs/index.js';

export const tv58Vector: TestVector = { meta: metaFor(58), run: runTv58 };
