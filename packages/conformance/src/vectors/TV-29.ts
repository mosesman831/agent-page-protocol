import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv29 } from './runs/index.js';

export const tv29Vector: TestVector = { meta: metaFor(29), run: runTv29 };
