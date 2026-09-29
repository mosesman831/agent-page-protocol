import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv57 } from './runs/index.js';

export const tv57Vector: TestVector = { meta: metaFor(57), run: runTv57 };
