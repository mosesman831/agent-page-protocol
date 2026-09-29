import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv128 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv128Vector: TestVector = { meta: metaFor(128), run: runTv128 };
attachStandalone(tv128Vector);
