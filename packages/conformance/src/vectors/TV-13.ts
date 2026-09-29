import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv13 } from './runs/index.js';

export const tv13Vector: TestVector = { meta: metaFor(13), run: runTv13 };
