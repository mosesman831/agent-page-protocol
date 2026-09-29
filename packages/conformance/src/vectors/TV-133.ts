import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv133 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv133Vector: TestVector = { meta: metaFor(133), run: runTv133 };
attachStandalone(tv133Vector);
