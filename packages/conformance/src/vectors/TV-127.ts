import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv127 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv127Vector: TestVector = { meta: metaFor(127), run: runTv127 };
attachStandalone(tv127Vector);
