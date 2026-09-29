import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv55 } from './runs/index.js';

export const tv55Vector: TestVector = { meta: metaFor(55), run: runTv55 };
