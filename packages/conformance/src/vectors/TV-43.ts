import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv43 } from './runs/index.js';

export const tv43Vector: TestVector = { meta: metaFor(43), run: runTv43 };
