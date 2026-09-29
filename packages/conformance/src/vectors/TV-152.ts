import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv152 } from './runs/index.js';

export const tv152Vector: TestVector = { meta: metaFor(152), run: runTv152 };
