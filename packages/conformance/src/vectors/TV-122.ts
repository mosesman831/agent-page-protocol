import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv122 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv122Vector: TestVector = { meta: metaFor(122), run: runTv122 };
attachStandalone(tv122Vector);
