import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv63 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv63Vector: TestVector = { meta: metaFor(63), run: runTv63 };
attachStandalone(tv63Vector);
