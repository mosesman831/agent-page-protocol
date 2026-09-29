import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv76 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv76Vector: TestVector = { meta: metaFor(76), run: runTv76 };
attachStandalone(tv76Vector);
