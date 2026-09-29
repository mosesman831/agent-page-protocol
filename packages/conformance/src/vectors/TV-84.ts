import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv84 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv84Vector: TestVector = { meta: metaFor(84), run: runTv84 };
attachStandalone(tv84Vector);
