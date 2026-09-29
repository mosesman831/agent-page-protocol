import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv16 } from './runs/index.js';

export const tv16Vector: TestVector = { meta: metaFor(16), run: runTv16 };
