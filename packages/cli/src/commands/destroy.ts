import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { CliContext, positionalArgs } from '../lib/args';
import { destroyApp } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

async function confirmDestroy(appId: string) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Destroy ${appId}? Type ${appId} to confirm: `);
    return answer.trim() === appId;
  } finally {
    rl.close();
  }
}

export async function destroy(ctx: CliContext) {
  const appArg = positionalArgs(ctx.commandArgs)[0];
  if (!appArg) printError(ctx, 'Usage: quickstack destroy <app> --yes [--json]');
  if (!ctx.commandArgs.includes('--yes') && (ctx.nonInteractive || !process.stdin.isTTY)) {
    printError(ctx, 'Refusing to destroy without --yes in a non-interactive shell.', 2);
  }
  const app = await resolveApp(appArg);
  const appId = app.id;
  if (!ctx.commandArgs.includes('--yes')) {
    const confirmed = await confirmDestroy(appId);
    if (!confirmed) printError(ctx, 'Destroy aborted.', 2);
  }
  const result = await destroyApp(appId);
  emit(ctx, 'success', { message: result.message, appId, result });
}
