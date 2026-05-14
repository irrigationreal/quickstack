import { CliContext } from '../lib/args';
import { QuickStackApiError, request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function services(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  const appArg = ctx.commandArgs[1];
  const app = sub === 'status' || !appArg ? undefined : await resolveApp(appArg);
  const appId = app?.id;
  if (sub === 'list') {
    if (!appId) printError(ctx, 'Usage: quickstack services list <app> [--json]');
    const result = await request(`/api/v1/agent/managed/services?appId=${encodeURIComponent(appId)}`);
    emit(ctx, 'success', { message: `Fetched attached services for ${appId}.`, appId, services: result.services });
    return;
  }
  if (sub === 'attach' || sub === 'detach') {
    const serviceId = ctx.commandArgs[2];
    if (!appId || !serviceId) printError(ctx, `Usage: quickstack services ${sub} <app> <service-id> [--json]`);
    const result = await request(`/api/v1/agent/managed/services/${sub}`, { method: 'POST', body: JSON.stringify({ appId, serviceId }) });
    emit(ctx, 'success', { message: `${sub === 'attach' ? 'Attached' : 'Detached'} ${serviceId} ${sub === 'attach' ? 'to' : 'from'} ${appId}.`, appId, result });
    return;
  }
  if (sub === 'status') {
    const serviceId = appArg;
    if (!serviceId) printError(ctx, 'Usage: quickstack services status <service-id> [--family postgres|redis|mysql] [--json]');
    const familyIndex = ctx.commandArgs.indexOf('--family');
    const requestedFamily = familyIndex >= 0 ? ctx.commandArgs[familyIndex + 1] : undefined;
    const families = requestedFamily ? [requestedFamily] : ['postgres', 'redis', 'mysql'];
    if (requestedFamily && !['postgres', 'redis', 'mysql'].includes(requestedFamily)) {
      printError(ctx, 'Invalid service family. Use --family postgres, --family redis, or --family mysql.', 2);
    }

    const familyErrors: string[] = [];
    for (const family of families) {
      try {
        const result = await request(`/api/v1/agent/managed/${encodeURIComponent(family)}?id=${encodeURIComponent(serviceId)}`);
        emit(ctx, 'success', { message: `Fetched ${family} service ${serviceId}.`, service: result.service });
        return;
      } catch (error) {
        if (!(error instanceof QuickStackApiError) || requestedFamily || ![400, 404].includes(error.status)) throw error;
        familyErrors.push(`${family}: ${error.message}`);
      }
    }

    printError(ctx, `Could not auto-detect managed service ${serviceId}. Pass --family postgres, --family redis, or --family mysql. Checked ${familyErrors.join('; ')}.`, 2);
  }
  printError(ctx, 'Usage: quickstack services <list|attach|detach|status> ...');
}
