import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CliContext } from '../lib/args';
import { printError } from '../lib/output';

export async function detect(ctx: CliContext) {
  const root = path.resolve(ctx.commandArgs.find(arg => !arg.startsWith('-')) || process.cwd());
  const result = spawnSync(process.execPath, [path.resolve('.agents/skills/quickdeploy/scripts/detect.mjs'), root], { encoding: 'utf8' });
  if (result.status !== 0) printError(ctx, (result.stderr || result.stdout || 'detect failed').trim(), result.status || 1);
  process.stdout.write(result.stdout);
}
