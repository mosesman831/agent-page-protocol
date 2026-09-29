import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv153 } from './runs/index.js';

export const tv153Vector: TestVector = { meta: metaFor(153), run: runTv153 };
