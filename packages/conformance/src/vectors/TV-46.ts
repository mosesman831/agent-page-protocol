import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv46 } from './runs/index.js';

export const tv46Vector: TestVector = { meta: metaFor(46), run: runTv46 };
