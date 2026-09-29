import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv09 } from './runs/index.js';

export const tv09Vector: TestVector = { meta: metaFor(9), run: runTv09 };
