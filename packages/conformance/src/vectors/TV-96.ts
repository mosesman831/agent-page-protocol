import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv96 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv96Vector: TestVector = { meta: metaFor(96), run: runTv96 };
attachStandalone(tv96Vector);
