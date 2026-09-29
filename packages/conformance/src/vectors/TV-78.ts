import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv78 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv78Vector: TestVector = { meta: metaFor(78), run: runTv78 };
attachStandalone(tv78Vector);
