import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv138 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv138Vector: TestVector = { meta: metaFor(138), run: runTv138 };
attachStandalone(tv138Vector);
