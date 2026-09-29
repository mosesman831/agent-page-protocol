import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv156 } from './runs/index.js';

export const tv156Vector: TestVector = { meta: metaFor(156), run: runTv156 };
