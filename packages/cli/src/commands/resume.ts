import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { resumeApp } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function resume(ctx: CliContext) {
  const appArg = positionalArgs(ctx.commandArgs)[0];
  const replicasArg = optionValue('--replicas', ctx.commandArgs);
  const replicas = replicasArg === undefined ? undefined : Number(replicasArg);
  if (!appArg || (replicasArg !== undefined && (!Number.isInteger(replicas) || (replicas ?? 0) < 1))) {
    printError(ctx, 'Usage: quickstack resume <app> [--replicas <count>] [--json]');
  }
  const app = await resolveApp(appArg);
  const payload = replicasArg === undefined ? undefined : { replicas: replicas as number };
  const result = await resumeApp(app.id, payload);
  emit(ctx, 'success', {
    message: `Resumed ${app.id} with ${result.replicas} replica(s).`,
    appId: app.id,
    result,
  });
}
