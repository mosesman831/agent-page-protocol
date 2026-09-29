import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv80 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv80Vector: TestVector = { meta: metaFor(80), run: runTv80 };
attachStandalone(tv80Vector);
