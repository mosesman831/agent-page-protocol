import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv89 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv89Vector: TestVector = { meta: metaFor(89), run: runTv89 };
attachStandalone(tv89Vector);
