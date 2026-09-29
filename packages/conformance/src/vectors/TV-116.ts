import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv116 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv116Vector: TestVector = { meta: metaFor(116), run: runTv116 };
attachStandalone(tv116Vector);
