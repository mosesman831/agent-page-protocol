import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv49 } from './runs/index.js';

export const tv49Vector: TestVector = { meta: metaFor(49), run: runTv49 };
