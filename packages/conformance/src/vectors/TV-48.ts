import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv48 } from './runs/index.js';

export const tv48Vector: TestVector = { meta: metaFor(48), run: runTv48 };
