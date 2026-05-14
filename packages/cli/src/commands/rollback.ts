import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';

export async function rollback(ctx: CliContext) {
  const appId = optionValue('--app', ctx.commandArgs) || positionalArgs(ctx.commandArgs)[0];
  if (!appId) printError(ctx, 'Usage: quickstack rollback <appId|path> [--json]');
  const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/rollback`, { method: 'POST' });
  emit(ctx, 'success', { message: `Rollback requested for ${appId}.`, appId, result });
}
