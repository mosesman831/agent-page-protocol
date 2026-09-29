import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv71 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv71Vector: TestVector = { meta: metaFor(71), run: runTv71 };
attachStandalone(tv71Vector);
