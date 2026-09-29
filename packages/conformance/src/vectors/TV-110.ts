import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv110 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv110Vector: TestVector = { meta: metaFor(110), run: runTv110 };
attachStandalone(tv110Vector);
