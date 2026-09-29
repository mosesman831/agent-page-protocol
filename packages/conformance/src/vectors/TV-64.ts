import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv64 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv64Vector: TestVector = { meta: metaFor(64), run: runTv64 };
attachStandalone(tv64Vector);
