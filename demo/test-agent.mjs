#!/usr/bin/env node
/**
 * test:agent — boots the demo server on an ephemeral port and runs the MCP
 * agent driver (agent-run.mjs) against it end-to-end. Exit non-zero on any
 * failed step or assertion. Requires `npm run build` (packages/mcp/dist).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8790 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [join(ROOT, 'demo/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});

function waitForServer(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('demo server did not start')), timeoutMs);
    const poll = async () => {
      try {
        const res = await fetch(`${BASE}/.well-known/agent-page`);
        if (res.ok) {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {
        /* not up yet */
      }
      setTimeout(poll, 150);
    };
    void poll();
  });
}

try {
  await waitForServer();
  const run = spawn(process.execPath, [join(ROOT, 'demo/agent-run.mjs'), '--base', BASE], {
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => run.on('exit', resolve));
  server.kill();
  process.exit(code ?? 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  server.kill();
  process.exit(1);
}
