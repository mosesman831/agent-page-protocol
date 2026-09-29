import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv119 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv119Vector: TestVector = { meta: metaFor(119), run: runTv119 };
attachStandalone(tv119Vector);
