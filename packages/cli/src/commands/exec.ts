import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';

export async function exec(ctx: CliContext) {
  const separator = ctx.commandArgs.indexOf('--');
  if (separator < 0 || separator === ctx.commandArgs.length - 1) printError(ctx, 'Usage: quickstack exec [appId|path] -- <command> [args...]');
  const appId = optionValue('--app', ctx.commandArgs) || positionalArgs(ctx.commandArgs.slice(0, separator))[0];
  if (!appId) printError(ctx, 'Usage: quickstack exec [appId|path] -- <command> [args...]');
  const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/exec`, { method: 'POST', body: JSON.stringify({ command: ctx.commandArgs.slice(separator + 1) }) });
  emit(ctx, 'success', { message: `Executed remote command for ${appId}.`, appId, result });
}
