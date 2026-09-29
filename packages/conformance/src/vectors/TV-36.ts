import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv36 } from './runs/index.js';

export const tv36Vector: TestVector = { meta: metaFor(36), run: runTv36 };
