import path from 'node:path';
import { CliContext } from '../lib/args';
import { emit, printError } from '../lib/output';
import { readProjectState } from '../lib/state';

export async function config(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'show';
  const rootArg = ctx.commandArgs.slice(1).find(arg => !arg.startsWith('-'));
  const root = path.resolve(rootArg || process.cwd());
  const state = await readProjectState(root);
  if (sub === 'show') {
    emit(ctx, 'success', { state });
    return;
  }
  if (sub === 'validate') {
    const secretLeak = JSON.stringify(state).match(/qstk_|password|secret|token/i);
    if (secretLeak) printError(ctx, 'Local .quickstack state appears to contain secret-like material. Remove it before committing.', 2);
    emit(ctx, 'success', { message: state.index || state.apps.length > 0 ? '.quickstack state passed the secret marker check.' : 'No .quickstack state found; nothing to validate.', state });
    return;
  }
  printError(ctx, 'Usage: quickstack config <show|validate|pull|repair>');
}
