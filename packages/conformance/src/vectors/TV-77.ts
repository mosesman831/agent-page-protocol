import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv77 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv77Vector: TestVector = { meta: metaFor(77), run: runTv77 };
attachStandalone(tv77Vector);
