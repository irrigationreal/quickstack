#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const [command, ...args] = process.argv.slice(2);

function run(script, scriptArgs) {
  const result = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', script), ...scriptArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

function help() {
  console.log(`QuickStack CLI preview

Usage:
  quickstack detect [path]
  quickstack package <path> --out <context.tar>
  quickstack api <me|ensure|upload|deploy> ...

Environment:
  QUICKSTACK_URL       QuickStack dashboard URL
  QUICKSTACK_API_KEY   qstk_ API key from the dashboard

Notes:
  This CLI is the local wrapper used by the QuickDeploy skill. The full one-shot
  managed deploy path depends on the QuickStack managed build/import APIs being
  available on the server.
`);
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
  help();
  process.exit(0);
}

if (command === 'detect') run('detect.mjs', [args[0] || process.cwd()]);
if (command === 'package') run('package.mjs', args);
if (command === 'api') run('quickstack-api.mjs', args);

console.error(`Unknown command: ${command}`);
help();
process.exit(1);
