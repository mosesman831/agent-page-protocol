import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv121 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv121Vector: TestVector = { meta: metaFor(121), run: runTv121 };
attachStandalone(tv121Vector);
