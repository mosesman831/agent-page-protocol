import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv139 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv139Vector: TestVector = { meta: metaFor(139), run: runTv139 };
attachStandalone(tv139Vector);
