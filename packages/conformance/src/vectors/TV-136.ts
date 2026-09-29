import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv136 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv136Vector: TestVector = { meta: metaFor(136), run: runTv136 };
attachStandalone(tv136Vector);
