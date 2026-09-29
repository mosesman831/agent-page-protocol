import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv120 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv120Vector: TestVector = { meta: metaFor(120), run: runTv120 };
attachStandalone(tv120Vector);
