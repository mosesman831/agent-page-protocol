import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv68 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv68Vector: TestVector = { meta: metaFor(68), run: runTv68 };
attachStandalone(tv68Vector);
