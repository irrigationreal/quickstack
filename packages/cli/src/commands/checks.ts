import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { listChecks, updateChecks } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function checks(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  if (sub === 'list') {
    const appArg = positionalArgs(ctx.commandArgs.slice(1))[0];
    if (!appArg) printError(ctx, 'Usage: quickstack checks list <app> [--json]');
    const app = await resolveApp(appArg);
    const appId = app.id;
    const result: any = await listChecks(appId);
    const passing = result.pods?.filter((pod: any) => pod.passing).length ?? 0;
    const total = result.pods?.length ?? 0;
    emit(ctx, 'success', { message: `Fetched checks for ${appId}: ${passing}/${total} pod(s) passing.`, appId, result });
    return;
  }
  if (sub === 'update') {
    const appArg = positionalArgs(ctx.commandArgs.slice(1))[0];
    if (!appArg) printError(ctx, 'Usage: quickstack checks update <app> --path <path> --port <port> [--threshold <n>] [--json]');
    const app = await resolveApp(appArg);
    const appId = app.id;
    const path = optionValue('--path', ctx.commandArgs);
    const port = Number(optionValue('--port', ctx.commandArgs));
    const thresholdRaw = optionValue('--threshold', ctx.commandArgs);
    const thresholdValue = thresholdRaw ? Number(thresholdRaw) : undefined;
    if (!path || !Number.isInteger(port)) printError(ctx, 'Usage: quickstack checks update <app> --path <path> --port <port> [--threshold <n>] [--json]', 2);
    const result = await updateChecks(appId, { path, port, ...(Number.isInteger(thresholdValue) ? { threshold: thresholdValue } : {}) });
    emit(ctx, 'success', { message: `Updated health checks for ${appId}.`, appId, checks: result.checks });
    return;
  }
  printError(ctx, 'Usage: quickstack checks <list|update> <app> [--json]');
}
