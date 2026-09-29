import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv17 } from './runs/index.js';

export const tv17Vector: TestVector = { meta: metaFor(17), run: runTv17 };
