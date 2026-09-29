import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv91 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv91Vector: TestVector = { meta: metaFor(91), run: runTv91 };
attachStandalone(tv91Vector);
