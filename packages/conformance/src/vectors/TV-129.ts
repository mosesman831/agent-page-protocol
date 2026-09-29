import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv129 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv129Vector: TestVector = { meta: metaFor(129), run: runTv129 };
attachStandalone(tv129Vector);
