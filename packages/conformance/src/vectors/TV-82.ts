import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv82 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv82Vector: TestVector = { meta: metaFor(82), run: runTv82 };
attachStandalone(tv82Vector);
