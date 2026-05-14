import { CliContext, optionValue } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';

export async function volumes(ctx: CliContext) {
  const sub = ctx.commandArgs[0];
  const appId = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
  if (!appId) printError(ctx, `Usage: quickstack volumes <list|add|remove> --app <appId>`);
  if (sub === 'list') {
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`);
    emit(ctx, 'success', { message: `Fetched volumes for ${appId}.`, appId, volumes: result.volumes || [] });
    return;
  }
  if (sub === 'add') {
    const containerMountPath = optionValue('--mount-path', ctx.commandArgs) || optionValue('--path', ctx.commandArgs);
    const size = Number(optionValue('--size', ctx.commandArgs));
    if (!containerMountPath || !Number.isInteger(size)) printError(ctx, 'quickstack volumes add requires --mount-path <container-path> --size <MiB>.');
    const payload = { id: optionValue('--id', ctx.commandArgs), containerMountPath, size, accessMode: optionValue('--access-mode', ctx.commandArgs) || 'ReadWriteOnce', storageClassName: optionValue('--storage-class', ctx.commandArgs) || 'longhorn', shareWithOtherApps: ctx.commandArgs.includes('--share') };
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`, { method: 'POST', body: JSON.stringify(payload) });
    emit(ctx, 'success', { message: `Attached volume ${result.volume.containerMountPath} to ${appId}. Redeploy the app for the mount to become active.`, appId, volume: result.volume });
    return;
  }
  if (sub === 'remove' || sub === 'rm') {
    const payload = optionValue('--id', ctx.commandArgs) ? { id: optionValue('--id', ctx.commandArgs) } : { containerMountPath: optionValue('--mount-path', ctx.commandArgs) || optionValue('--path', ctx.commandArgs) };
    if (!payload.id && !payload.containerMountPath) printError(ctx, 'quickstack volumes remove requires --id <volumeId> or --mount-path <container-path>.');
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`, { method: 'DELETE', body: JSON.stringify(payload) });
    emit(ctx, 'success', { message: `Detached volume from ${appId}. Redeploy the app for the detach to take effect.`, appId, removed: result.removed });
    return;
  }
  printError(ctx, 'Usage: quickstack volumes <list|add|remove> [path] --app <appId> [--mount-path <path> --size <MiB>]');
}
