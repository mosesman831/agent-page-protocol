import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv50 } from './runs/index.js';

export const tv50Vector: TestVector = { meta: metaFor(50), run: runTv50 };
