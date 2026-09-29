import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv109 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv109Vector: TestVector = { meta: metaFor(109), run: runTv109 };
attachStandalone(tv109Vector);
