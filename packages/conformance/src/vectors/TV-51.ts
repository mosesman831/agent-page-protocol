import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv51 } from './runs/index.js';

export const tv51Vector: TestVector = { meta: metaFor(51), run: runTv51 };
