import { CliContext, positionalArgs } from '../lib/args';
import { listIps } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function ips(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  if (sub !== 'list') printError(ctx, 'Usage: quickstack ips list <app> [--json]');
  const appArg = positionalArgs(ctx.commandArgs.slice(1))[0];
  if (!appArg) printError(ctx, 'Usage: quickstack ips list <app> [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const result = await listIps(appId);
  emit(ctx, 'success', { message: `Fetched ${result.ips.length} IP address(es) for ${appId}.`, appId, ips: result.ips });
}
