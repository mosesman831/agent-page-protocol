import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv108 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv108Vector: TestVector = { meta: metaFor(108), run: runTv108 };
attachStandalone(tv108Vector);
