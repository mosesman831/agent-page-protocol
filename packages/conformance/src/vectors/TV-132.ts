import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv132 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv132Vector: TestVector = { meta: metaFor(132), run: runTv132 };
attachStandalone(tv132Vector);
