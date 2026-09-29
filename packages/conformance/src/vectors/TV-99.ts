import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv99 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv99Vector: TestVector = { meta: metaFor(99), run: runTv99 };
attachStandalone(tv99Vector);
