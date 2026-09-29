import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv88 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv88Vector: TestVector = { meta: metaFor(88), run: runTv88 };
attachStandalone(tv88Vector);
