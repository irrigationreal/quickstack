import { spawnSync } from 'node:child_process';
import { CliContext } from '../lib/args';
import { emit, printError } from '../lib/output';

export async function packageCommand(ctx: CliContext) {
  const source = ctx.commandArgs.find(arg => !arg.startsWith('-'));
  const outIndex = ctx.commandArgs.indexOf('--out');
  const out = outIndex >= 0 ? ctx.commandArgs[outIndex + 1] : undefined;
  if (!source || !out) printError(ctx, 'Usage: quickstack package <path> --out <context.tar>');
  const result = spawnSync('tar', ['-C', source, '-cf', out, '.'], { stdio: ctx.json ? 'pipe' : 'inherit', encoding: ctx.json ? 'utf8' : undefined });
  if (result.status !== 0) printError(ctx, `tar -C ${source} -cf ${out} . failed.`, result.status || 1);
  emit(ctx, 'success', { message: `Packaged ${source} to ${out}.`, out });
}
