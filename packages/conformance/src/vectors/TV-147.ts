import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv147 } from './runs/index.js';

export const tv147Vector: TestVector = { meta: metaFor(147), run: runTv147 };
