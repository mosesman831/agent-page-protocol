import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv19 } from './runs/index.js';

export const tv19Vector: TestVector = { meta: metaFor(19), run: runTv19 };
