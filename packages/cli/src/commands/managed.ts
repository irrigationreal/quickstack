import { CliContext, optionValue } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';

export async function managed(ctx: CliContext, kind: 'postgres' | 'redis') {
  const sub = ctx.commandArgs[0];
  const noun = kind === 'postgres' ? 'Postgres' : 'Redis';
  const route = `/api/v1/agent/managed/${kind}`;
  if (sub === 'create') {
    const projectId = optionValue('--project', ctx.commandArgs);
    if (!projectId) printError(ctx, `Usage: quickstack ${kind} create --project <projectId> [--attach <appId>] [--name <name>]`);
    const payload: any = { projectId, name: optionValue('--name', ctx.commandArgs), attachAppId: optionValue('--attach', ctx.commandArgs), secretName: optionValue('--secret-name', ctx.commandArgs) || (kind === 'postgres' ? 'DATABASE_URL' : 'REDIS_URL') };
    if (kind === 'postgres') {
      payload.databaseName = optionValue('--database', ctx.commandArgs);
      payload.username = optionValue('--username', ctx.commandArgs);
    }
    const result = await request(route, { method: 'POST', body: JSON.stringify(payload) });
    emit(ctx, 'success', { message: `Created and deployed ${noun}.`, result });
    return;
  }
  if (sub === 'list') {
    const projectId = optionValue('--project', ctx.commandArgs);
    if (!projectId) printError(ctx, `Usage: quickstack ${kind} list --project <projectId>`);
    const result = await request(`${route}?projectId=${encodeURIComponent(projectId)}`);
    emit(ctx, 'success', { message: `Fetched managed ${noun} resources.`, result });
    return;
  }
  if (sub === 'attach') {
    const managedAppId = ctx.commandArgs[1];
    const appId = optionValue('--app', ctx.commandArgs);
    if (!managedAppId || !appId) printError(ctx, `Usage: quickstack ${kind} attach <${kind}AppId> --app <appId>`);
    const result = await request(route, { method: 'POST', body: JSON.stringify({ mode: 'attach', [`${kind === 'postgres' ? 'database' : 'redis'}AppId`]: managedAppId, appId, secretName: optionValue('--secret-name', ctx.commandArgs) || (kind === 'postgres' ? 'DATABASE_URL' : 'REDIS_URL') }) });
    emit(ctx, 'success', { message: `Attached ${noun} ${managedAppId} to ${appId}.`, result });
    return;
  }
  if (sub === 'destroy') {
    const managedAppId = ctx.commandArgs[1];
    if (!managedAppId) printError(ctx, `Usage: quickstack ${kind} destroy <${kind}AppId>`);
    const result = await request(route, { method: 'DELETE', body: JSON.stringify({ [`${kind === 'postgres' ? 'database' : 'redis'}AppId`]: managedAppId }) });
    emit(ctx, 'success', { message: `Destroyed managed ${noun} ${managedAppId}.`, result });
    return;
  }
  printError(ctx, `Usage: quickstack ${kind} <create|list|attach|destroy> ...`);
}
