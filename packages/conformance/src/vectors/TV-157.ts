import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv157 } from './runs/index.js';

export const tv157Vector: TestVector = { meta: metaFor(157), run: runTv157 };
