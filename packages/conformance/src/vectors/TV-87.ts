import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv87 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv87Vector: TestVector = { meta: metaFor(87), run: runTv87 };
attachStandalone(tv87Vector);
