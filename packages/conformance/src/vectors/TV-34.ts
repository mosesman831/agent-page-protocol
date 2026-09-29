import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv34 } from './runs/index.js';

export const tv34Vector: TestVector = { meta: metaFor(34), run: runTv34 };
