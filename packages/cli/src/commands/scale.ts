import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';

export async function scale(ctx: CliContext) {
  const appId = optionValue('--app', ctx.commandArgs) || positionalArgs(ctx.commandArgs)[0];
  const replicas = Number(optionValue('--replicas', ctx.commandArgs));
  if (!appId || !Number.isInteger(replicas)) printError(ctx, 'Usage: quickstack scale <appId|path> --replicas <count> [--json]');
  const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/scale`, { method: 'POST', body: JSON.stringify({ replicas }) });
  emit(ctx, 'success', { message: `Scaled ${appId} to ${replicas} replica(s).`, appId, result });
}
