import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv95 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv95Vector: TestVector = { meta: metaFor(95), run: runTv95 };
attachStandalone(tv95Vector);
