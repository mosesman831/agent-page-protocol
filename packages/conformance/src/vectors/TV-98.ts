import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv98 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv98Vector: TestVector = { meta: metaFor(98), run: runTv98 };
attachStandalone(tv98Vector);
