import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv62 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv62Vector: TestVector = { meta: metaFor(62), run: runTv62 };
attachStandalone(tv62Vector);
