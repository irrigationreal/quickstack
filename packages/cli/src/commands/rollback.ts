import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function rollback(ctx: CliContext) {
  const appArg = optionValue('--app', ctx.commandArgs) || positionalArgs(ctx.commandArgs)[0];
  if (!appArg) printError(ctx, 'Usage: quickstack rollback <app> [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/rollback`, { method: 'POST' });
  emit(ctx, 'success', { message: `Rollback requested for ${appId}.`, appId, result });
}
