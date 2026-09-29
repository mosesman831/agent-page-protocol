import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv124 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv124Vector: TestVector = { meta: metaFor(124), run: runTv124 };
attachStandalone(tv124Vector);
