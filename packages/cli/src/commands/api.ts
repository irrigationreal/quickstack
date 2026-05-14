import { CliContext } from '../lib/args';
import { request, uploadBuild } from '../lib/api-client';
import { printError } from '../lib/output';

function parseJsonArg(ctx: CliContext, index: number, name: string) {
  const value = ctx.commandArgs[index];
  if (!value) printError(ctx, `${name} JSON argument is required.`);
  try { return JSON.parse(value); } catch { printError(ctx, `${name} must be valid JSON.`); }
}

export async function api(ctx: CliContext) {
  const sub = ctx.commandArgs[0];
  let body: unknown;
  if (sub === 'me' || sub === 'whoami') body = await request('/api/v1/agent/me');
  else if (sub === 'ensure') body = await request('/api/v1/agent/apps/ensure', { method: 'POST', body: JSON.stringify(parseJsonArg(ctx, 1, 'ensure payload')) });
  else if (sub === 'upload') {
    const appId = ctx.commandArgs[1];
    const tarPath = ctx.commandArgs[2];
    if (!appId || !tarPath) printError(ctx, 'Usage: quickstack api upload <appId> <tarPath> <metadataJson>');
    body = await uploadBuild(appId, tarPath, parseJsonArg(ctx, 3, 'upload metadata'));
  } else if (sub === 'deploy' || sub === 'rollback') {
    const appId = ctx.commandArgs[1];
    if (!appId) printError(ctx, `Usage: quickstack api ${sub} <appId>`);
    body = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/${sub}`, { method: 'POST' });
  } else if (sub === 'scale') {
    const appId = ctx.commandArgs[1];
    const replicas = Number(ctx.commandArgs[2]);
    if (!appId || !Number.isInteger(replicas)) printError(ctx, 'Usage: quickstack api scale <appId> <replicas>');
    body = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/scale`, { method: 'POST', body: JSON.stringify({ replicas }) });
  } else if (['status', 'logs', 'releases', 'secrets-list', 'endpoints-list', 'volumes-list'].includes(sub || '')) {
    const appId = ctx.commandArgs[1];
    if (!appId) printError(ctx, `Usage: quickstack api ${sub} <appId>`);
    const route = sub!.replace(/-list$/, '');
    body = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/${route}`);
  } else if (['secrets-set', 'endpoints-reserve', 'volumes-add'].includes(sub || '')) {
    const appId = ctx.commandArgs[1];
    if (!appId) printError(ctx, `Usage: quickstack api ${sub} <appId> <payloadJson>`);
    const route = sub!.replace('secrets-set', 'secrets').replace('endpoints-reserve', 'endpoints').replace('volumes-add', 'volumes');
    body = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/${route}`, { method: 'POST', body: JSON.stringify(parseJsonArg(ctx, 2, `${sub} payload`)) });
  } else if (['endpoints-release', 'volumes-remove'].includes(sub || '')) {
    const appId = ctx.commandArgs[1];
    if (!appId) printError(ctx, `Usage: quickstack api ${sub} <appId> <payloadJson>`);
    const route = sub!.replace('endpoints-release', 'endpoints').replace('volumes-remove', 'volumes');
    body = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/${route}`, { method: 'DELETE', body: JSON.stringify(parseJsonArg(ctx, 2, `${sub} payload`)) });
  } else if (sub?.startsWith('postgres')) {
    if (sub === 'postgres-list') body = await request(`/api/v1/agent/managed/postgres?projectId=${encodeURIComponent(ctx.commandArgs[1] || '')}`);
    else body = await request('/api/v1/agent/managed/postgres', { method: sub === 'postgres-destroy' ? 'DELETE' : 'POST', body: JSON.stringify(parseJsonArg(ctx, 1, 'postgres payload')) });
  } else if (sub?.startsWith('redis')) {
    if (sub === 'redis-list') body = await request(`/api/v1/agent/managed/redis?projectId=${encodeURIComponent(ctx.commandArgs[1] || '')}`);
    else body = await request('/api/v1/agent/managed/redis', { method: sub === 'redis-destroy' ? 'DELETE' : 'POST', body: JSON.stringify(parseJsonArg(ctx, 1, 'redis payload')) });
  } else {
    printError(ctx, 'Usage: quickstack api <me|ensure|upload|deploy|scale|rollback|status|logs|releases|secrets-list|secrets-set|endpoints-list|endpoints-reserve|endpoints-release|volumes-list|volumes-add|volumes-remove|exec|postgres|postgres-list|postgres-destroy|redis|redis-list|redis-destroy> ...');
  }
  console.log(JSON.stringify(body, null, 2));
}
