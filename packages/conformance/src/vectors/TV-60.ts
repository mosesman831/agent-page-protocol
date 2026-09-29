import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv60 } from './runs/index.js';

export const tv60Vector: TestVector = { meta: metaFor(60), run: runTv60 };
