import { CliContext, positionalArgs } from '../lib/args';
import { suspendApp } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function suspend(ctx: CliContext) {
  const appArg = positionalArgs(ctx.commandArgs)[0];
  if (!appArg) printError(ctx, 'Usage: quickstack suspend <app> [--json]');
  const app = await resolveApp(appArg);
  const result = await suspendApp(app.id);
  emit(ctx, 'success', {
    message: `Suspended ${app.id}.`,
    appId: app.id,
    result,
  });
}
