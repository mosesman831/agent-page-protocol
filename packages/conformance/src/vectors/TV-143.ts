import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv143 } from './runs/index.js';

export const tv143Vector: TestVector = { meta: metaFor(143), run: runTv143 };
