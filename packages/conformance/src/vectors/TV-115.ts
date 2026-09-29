import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv115 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv115Vector: TestVector = { meta: metaFor(115), run: runTv115 };
attachStandalone(tv115Vector);
