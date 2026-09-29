import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv154 } from './runs/index.js';

export const tv154Vector: TestVector = { meta: metaFor(154), run: runTv154 };
