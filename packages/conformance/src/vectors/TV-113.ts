import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv113 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv113Vector: TestVector = { meta: metaFor(113), run: runTv113 };
attachStandalone(tv113Vector);
