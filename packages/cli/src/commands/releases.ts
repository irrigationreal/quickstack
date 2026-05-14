import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { getRelease } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { remoteRead } from './remote-read';
import { resolveApp } from './apps';

export async function releases(ctx: CliContext) {
  if (ctx.commandArgs[0] !== 'show') return remoteRead(ctx, 'releases');
  const releaseId = ctx.commandArgs[1];
  const appArg = optionValue('--app', ctx.commandArgs) || positionalArgs(ctx.commandArgs.slice(2))[0];
  if (!releaseId || !appArg) printError(ctx, 'Usage: quickstack releases show <release-id> --app <app> [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const result = await getRelease(appId, releaseId);
  emit(ctx, 'success', { message: `Fetched release ${releaseId}.`, appId, release: result.release, deploymentRecord: result.deploymentRecord });
}
