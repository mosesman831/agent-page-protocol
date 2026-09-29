import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv75 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv75Vector: TestVector = { meta: metaFor(75), run: runTv75 };
attachStandalone(tv75Vector);
