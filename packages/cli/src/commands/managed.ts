import { CliContext, optionValue } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import type { ManagedServiceFamily } from '../../../../src/shared/model/agent-managed-service.model';
import { resolveApp } from './apps';

const managedServiceCliMetadata: Record<ManagedServiceFamily, { idKey: string; noun: string; secretName: string }> = {
  postgres: { idKey: 'databaseAppId', noun: 'Postgres', secretName: 'DATABASE_URL' },
  redis: { idKey: 'redisAppId', noun: 'Redis', secretName: 'REDIS_URL' },
  mysql: { idKey: 'mysqlAppId', noun: 'MySQL', secretName: 'MYSQL_URL' },
};

export async function managed(ctx: CliContext, kind: ManagedServiceFamily) {
  const sub = ctx.commandArgs[0];
  const metadata = managedServiceCliMetadata[kind];
  const route = `/api/v1/agent/managed/${kind}`;
  if (sub === 'create') {
    const projectId = optionValue('--project', ctx.commandArgs);
    if (!projectId) printError(ctx, `Usage: quickstack ${kind} create --project <projectId> [--attach <appId>] [--name <name>]`);
    const attachArg = optionValue('--attach', ctx.commandArgs);
    const payload: any = { projectId, name: optionValue('--name', ctx.commandArgs), attachAppId: attachArg ? (await resolveApp(attachArg)).id : undefined, secretName: optionValue('--secret-name', ctx.commandArgs) || metadata.secretName };
    if (kind === 'postgres' || kind === 'mysql') {
      payload.databaseName = optionValue('--database', ctx.commandArgs);
      payload.username = optionValue('--username', ctx.commandArgs);
    }
    const result = await request(route, { method: 'POST', body: JSON.stringify(payload) });
    emit(ctx, 'success', { message: `Created and deployed ${metadata.noun}.`, result });
    return;
  }
  if (sub === 'list') {
    const projectId = optionValue('--project', ctx.commandArgs);
    if (!projectId) printError(ctx, `Usage: quickstack ${kind} list --project <projectId>`);
    const result = await request(`${route}?projectId=${encodeURIComponent(projectId)}`);
    emit(ctx, 'success', { message: `Fetched managed ${metadata.noun} resources.`, result });
    return;
  }
  if (sub === 'status') {
    const managedAppId = ctx.commandArgs[1];
    if (!managedAppId) printError(ctx, `Usage: quickstack ${kind} status <${kind}AppId>`);
    const result = await request(`${route}?id=${encodeURIComponent(managedAppId)}`);
    emit(ctx, 'success', { message: `Fetched ${metadata.noun} status for ${managedAppId}.`, service: result.service });
    return;
  }
  if (sub === 'attach') {
    const managedAppId = ctx.commandArgs[1];
    const appArg = optionValue('--app', ctx.commandArgs);
    if (!managedAppId || !appArg) printError(ctx, `Usage: quickstack ${kind} attach <${kind}AppId> --app <app>`);
    const appId = (await resolveApp(appArg)).id;
    const result = await request(route, { method: 'POST', body: JSON.stringify({ mode: 'attach', [metadata.idKey]: managedAppId, appId, secretName: optionValue('--secret-name', ctx.commandArgs) || metadata.secretName }) });
    emit(ctx, 'success', { message: `Attached ${metadata.noun} ${managedAppId} to ${appId}.`, result });
    return;
  }
  if (sub === 'destroy') {
    const managedAppId = ctx.commandArgs[1];
    if (!managedAppId) printError(ctx, `Usage: quickstack ${kind} destroy <${kind}AppId>`);
    const result = await request(route, { method: 'DELETE', body: JSON.stringify({ [metadata.idKey]: managedAppId }) });
    emit(ctx, 'success', { message: `Destroyed managed ${metadata.noun} ${managedAppId}.`, result });
    return;
  }
  printError(ctx, `Usage: quickstack ${kind} <create|list|attach|destroy|status> ...`);
}
