import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv105 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv105Vector: TestVector = { meta: metaFor(105), run: runTv105 };
attachStandalone(tv105Vector);
