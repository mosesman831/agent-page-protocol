import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv37 } from './runs/index.js';

export const tv37Vector: TestVector = { meta: metaFor(37), run: runTv37 };
