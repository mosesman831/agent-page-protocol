import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv22 } from './runs/index.js';

export const tv22Vector: TestVector = { meta: metaFor(22), run: runTv22 };
