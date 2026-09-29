import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv93 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv93Vector: TestVector = { meta: metaFor(93), run: runTv93 };
attachStandalone(tv93Vector);
