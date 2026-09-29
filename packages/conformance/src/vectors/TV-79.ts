import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv79 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv79Vector: TestVector = { meta: metaFor(79), run: runTv79 };
attachStandalone(tv79Vector);
