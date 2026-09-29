import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv125 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv125Vector: TestVector = { meta: metaFor(125), run: runTv125 };
attachStandalone(tv125Vector);
