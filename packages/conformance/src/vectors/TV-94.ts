import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv94 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv94Vector: TestVector = { meta: metaFor(94), run: runTv94 };
attachStandalone(tv94Vector);
