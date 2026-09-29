import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv107 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv107Vector: TestVector = { meta: metaFor(107), run: runTv107 };
attachStandalone(tv107Vector);
