import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv126 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv126Vector: TestVector = { meta: metaFor(126), run: runTv126 };
attachStandalone(tv126Vector);
