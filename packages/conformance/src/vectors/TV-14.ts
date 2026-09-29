import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv14 } from './runs/index.js';

export const tv14Vector: TestVector = { meta: metaFor(14), run: runTv14 };
