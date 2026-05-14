import { CliContext, positionalArgs } from '../lib/args';
import { cancelJob, listJobs, runJob, showJob } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function jobs(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  const args = positionalArgs(ctx.commandArgs.slice(1));

  if (sub === 'list') {
    const appArg = args[0];
    if (!appArg) printError(ctx, 'Usage: quickstack jobs list <app> [--json]');
    const app = await resolveApp(appArg);
    const result = await listJobs(app.id);
    emit(ctx, 'success', { message: `Listed ${result.jobs.length} job(s) for ${app.id}.`, appId: app.id, jobs: result.jobs });
    return;
  }

  if (sub === 'show') {
    const [appArg, jobId] = args;
    if (!appArg || !jobId) printError(ctx, 'Usage: quickstack jobs show <app> <job> [--json]');
    const app = await resolveApp(appArg);
    const result = await showJob(app.id, jobId);
    emit(ctx, 'success', { message: `Fetched job ${jobId} for ${app.id}.`, appId: app.id, job: result.job });
    return;
  }

  if (sub === 'cancel') {
    const [appArg, jobId] = args;
    if (!appArg || !jobId) printError(ctx, 'Usage: quickstack jobs cancel <app> <job> [--json]');
    const app = await resolveApp(appArg);
    const result = await cancelJob(app.id, jobId);
    emit(ctx, 'success', { message: `Cancelled job ${jobId} for ${app.id}.`, appId: app.id, jobId: result.jobId, cancelled: result.cancelled });
    return;
  }

  if (sub === 'run') {
    const appArg = args[0];
    if (!appArg) printError(ctx, 'Usage: quickstack jobs run <app> [--json]');
    const app = await resolveApp(appArg);
    const result = await runJob(app.id, {});
    emit(ctx, 'success', { message: `Started job for ${app.id}.`, appId: app.id, job: result.job });
    return;
  }

  printError(ctx, 'Usage: quickstack jobs <run|list|show|cancel> <app> [job] [--json]');
}
