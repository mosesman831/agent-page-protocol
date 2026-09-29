import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv52 } from './runs/index.js';

export const tv52Vector: TestVector = { meta: metaFor(52), run: runTv52 };
