import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv135 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv135Vector: TestVector = { meta: metaFor(135), run: runTv135 };
attachStandalone(tv135Vector);
