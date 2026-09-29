import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv131 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv131Vector: TestVector = { meta: metaFor(131), run: runTv131 };
attachStandalone(tv131Vector);
