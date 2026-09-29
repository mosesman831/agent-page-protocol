import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv23 } from './runs/index.js';

export const tv23Vector: TestVector = { meta: metaFor(23), run: runTv23 };
