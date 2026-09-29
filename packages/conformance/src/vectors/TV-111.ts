import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv111 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv111Vector: TestVector = { meta: metaFor(111), run: runTv111 };
attachStandalone(tv111Vector);
