import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv85 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv85Vector: TestVector = { meta: metaFor(85), run: runTv85 };
attachStandalone(tv85Vector);
