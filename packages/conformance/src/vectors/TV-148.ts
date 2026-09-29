import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv148 } from './runs/index.js';

export const tv148Vector: TestVector = { meta: metaFor(148), run: runTv148 };
