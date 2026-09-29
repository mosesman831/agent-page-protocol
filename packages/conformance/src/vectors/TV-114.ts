import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv114 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv114Vector: TestVector = { meta: metaFor(114), run: runTv114 };
attachStandalone(tv114Vector);
