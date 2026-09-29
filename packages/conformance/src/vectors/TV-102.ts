import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv102 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv102Vector: TestVector = { meta: metaFor(102), run: runTv102 };
attachStandalone(tv102Vector);
