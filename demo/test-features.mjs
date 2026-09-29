#!/usr/bin/env node
/**
 * test:features — boots the demo server on an ephemeral port and runs the
 * full protocol-feature sweep (features-run.mjs) against it end-to-end in both
 * MCP modes — fixed tools, then --dynamic per-action projection — then the CLI
 * sweep (features-cli.mjs). Exit non-zero on any failed check. Requires
 * `npm run build` (packages/mcp/dist + packages/cli/dist).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8850 + Math.floor(Math.random() * 40);
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

function runDriver(script, extraArgs) {
  const run = spawn(process.execPath, [join(ROOT, 'demo', script), '--base', BASE, ...extraArgs], {
    stdio: 'inherit',
  });
  return new Promise((resolve) => run.on('exit', resolve));
}

try {
  await waitForServer();
  console.log('--- features sweep: MCP fixed tools ---');
  const code1 = await runDriver('features-run.mjs', []);
  if (code1 !== 0) {
    server.kill();
    process.exit(code1 ?? 1);
  }
  console.log('--- features sweep: MCP dynamic tools ---');
  const code2 = await runDriver('features-run.mjs', ['--dynamic']);
  if (code2 !== 0) {
    server.kill();
    process.exit(code2 ?? 1);
  }
  console.log('--- features sweep: CLI ---');
  const code3 = await runDriver('features-cli.mjs', []);
  server.kill();
  process.exit(code3 ?? 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  server.kill();
  process.exit(1);
}
