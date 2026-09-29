import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv40 } from './runs/index.js';

export const tv40Vector: TestVector = { meta: metaFor(40), run: runTv40 };
