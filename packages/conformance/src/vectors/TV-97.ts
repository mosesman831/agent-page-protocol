import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv97 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv97Vector: TestVector = { meta: metaFor(97), run: runTv97 };
attachStandalone(tv97Vector);
