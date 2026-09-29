import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv74 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv74Vector: TestVector = { meta: metaFor(74), run: runTv74 };
attachStandalone(tv74Vector);
