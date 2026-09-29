import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv142 } from './runs/index.js';

export const tv142Vector: TestVector = { meta: metaFor(142), run: runTv142 };
