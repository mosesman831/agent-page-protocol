import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv32 } from './runs/index.js';

export const tv32Vector: TestVector = { meta: metaFor(32), run: runTv32 };
