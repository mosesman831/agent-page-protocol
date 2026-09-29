import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv69 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv69Vector: TestVector = { meta: metaFor(69), run: runTv69 };
attachStandalone(tv69Vector);
