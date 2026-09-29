import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv146 } from './runs/index.js';

export const tv146Vector: TestVector = { meta: metaFor(146), run: runTv146 };
