import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv103 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv103Vector: TestVector = { meta: metaFor(103), run: runTv103 };
attachStandalone(tv103Vector);
