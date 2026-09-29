import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv30 } from './runs/index.js';

export const tv30Vector: TestVector = { meta: metaFor(30), run: runTv30 };
