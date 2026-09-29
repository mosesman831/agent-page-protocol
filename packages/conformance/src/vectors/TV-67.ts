import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv67 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv67Vector: TestVector = { meta: metaFor(67), run: runTv67 };
attachStandalone(tv67Vector);
