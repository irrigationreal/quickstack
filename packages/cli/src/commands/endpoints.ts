import { CliContext, optionValue } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

function requiredNumber(ctx: CliContext, name: string) {
  const value = Number(optionValue(name, ctx.commandArgs));
  if (!Number.isInteger(value)) printError(ctx, `${name} must be an integer.`);
  return value;
}

export async function endpoints(ctx: CliContext) {
  const sub = ctx.commandArgs[0];
  const appArg = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
  if (!appArg) printError(ctx, `Usage: quickstack endpoints <list|reserve|release> --app <app>`);
  const app = await resolveApp(appArg);
  const appId = app.id;
  if (sub === 'list') {
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/endpoints`);
    emit(ctx, 'success', { message: `Fetched public endpoint reservations for ${appId}.`, appId, endpoints: result.endpoints || [] });
    return;
  }
  if (sub === 'reserve') {
    const publicIp = optionValue('--public-ip', ctx.commandArgs) || optionValue('--ip', ctx.commandArgs);
    if (!publicIp) printError(ctx, 'quickstack endpoints reserve requires --public-ip <ip>.');
    const payload = { id: optionValue('--id', ctx.commandArgs), name: optionValue('--name', ctx.commandArgs), publicIp, publicPort: requiredNumber(ctx, '--public-port'), targetPort: requiredNumber(ctx, '--target-port'), protocol: (optionValue('--protocol', ctx.commandArgs) || 'TCP').toUpperCase(), sourceCidrsText: optionValue('--source-cidrs', ctx.commandArgs) || '', enabled: !ctx.commandArgs.includes('--disabled') };
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/endpoints`, { method: 'POST', body: JSON.stringify(payload) });
    emit(ctx, 'success', { message: `Reserved ${result.endpoint.publicIp}:${result.endpoint.publicPort}/${result.endpoint.protocol} for ${appId}.`, appId, endpoint: result.endpoint });
    return;
  }
  if (sub === 'release') {
    const payload = optionValue('--id', ctx.commandArgs) ? { id: optionValue('--id', ctx.commandArgs) } : { publicIp: optionValue('--public-ip', ctx.commandArgs) || optionValue('--ip', ctx.commandArgs), publicPort: requiredNumber(ctx, '--public-port'), protocol: (optionValue('--protocol', ctx.commandArgs) || 'TCP').toUpperCase() };
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/endpoints`, { method: 'DELETE', body: JSON.stringify(payload) });
    emit(ctx, 'success', { message: `Released endpoint from ${appId}.`, appId, released: result.released });
    return;
  }
  printError(ctx, 'Usage: quickstack endpoints <list|reserve|release> [path] --app <appId> [--public-ip <ip> --public-port <port> --target-port <port>]');
}
