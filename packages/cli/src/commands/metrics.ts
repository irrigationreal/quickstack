import { CliContext, positionalArgs } from '../lib/args';
import { getMetrics } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function metrics(ctx: CliContext) {
  const appArg = positionalArgs(ctx.commandArgs)[0];
  if (!appArg) printError(ctx, 'Usage: quickstack metrics <app> [--json]');
  const app = await resolveApp(appArg);
  const result = await getMetrics(app.id);
  emit(ctx, 'success', {
    message: `Fetched metrics for ${app.id}.`,
    appId: app.id,
    metrics: result.metrics,
  });
}
