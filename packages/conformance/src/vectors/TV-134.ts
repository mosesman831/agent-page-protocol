import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv134 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv134Vector: TestVector = { meta: metaFor(134), run: runTv134 };
attachStandalone(tv134Vector);
