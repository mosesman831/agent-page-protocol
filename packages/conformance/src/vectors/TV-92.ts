import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv92 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv92Vector: TestVector = { meta: metaFor(92), run: runTv92 };
attachStandalone(tv92Vector);
