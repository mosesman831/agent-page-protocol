import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv101 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv101Vector: TestVector = { meta: metaFor(101), run: runTv101 };
attachStandalone(tv101Vector);
