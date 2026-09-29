import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv137 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv137Vector: TestVector = { meta: metaFor(137), run: runTv137 };
attachStandalone(tv137Vector);
