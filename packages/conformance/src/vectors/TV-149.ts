import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv149 } from './runs/index.js';

export const tv149Vector: TestVector = { meta: metaFor(149), run: runTv149 };
