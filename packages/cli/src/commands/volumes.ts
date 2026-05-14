import { CliContext, optionValue } from '../lib/args';
import { createVolume, destroyVolume, listVolumes, updateVolume } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

function sizeToMiB(value: string | undefined) {
  if (!value) return NaN;
  const match = value.match(/^(\d+)(mi|mib|gi|gib)?$/i);
  if (!match) return Number(value);
  const amount = Number(match[1]);
  const unit = (match[2] || 'mib').toLowerCase();
  return unit.startsWith('g') ? amount * 1024 : amount;
}

export async function volumes(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  const appArg = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
  if (!appArg) printError(ctx, `Usage: quickstack volumes <list|show|create|update|destroy> --app <app>`);
  const app = await resolveApp(appArg);
  const appId = app.id;
  if (sub === 'list') {
    const result = await listVolumes(appId);
    emit(ctx, 'success', { message: `Fetched ${result.volumes.length} volume(s) for ${appId}.`, appId, volumes: result.volumes, storage: result.storage });
    return;
  }
  if (sub === 'show') {
    const result = await listVolumes(appId);
    const volumeName = ctx.commandArgs[2] || optionValue('--id', ctx.commandArgs) || optionValue('--mount-path', ctx.commandArgs);
    const volume = result.volumes.find((item: any) => item.id === volumeName || item.name === volumeName || item.mountPath === volumeName || item.containerMountPath === volumeName);
    if (!volume) printError(ctx, `Volume not found: ${volumeName}`);
    emit(ctx, 'success', { message: `Fetched volume ${volume.mountPath}.`, appId, volume });
    return;
  }
  if (sub === 'add' || sub === 'create') {
    const containerMountPath = optionValue('--mount-path', ctx.commandArgs) || optionValue('--path', ctx.commandArgs) || ctx.commandArgs[2];
    const size = sizeToMiB(optionValue('--size', ctx.commandArgs));
    if (!containerMountPath || !Number.isInteger(size)) printError(ctx, 'quickstack volumes create requires <app> <mount-path> --size <MiB|Gi>.');
    const payload = { id: optionValue('--id', ctx.commandArgs), containerMountPath, size, accessMode: optionValue('--access-mode', ctx.commandArgs) || 'ReadWriteOnce', storageClassName: optionValue('--storage-class', ctx.commandArgs) || 'longhorn', shareWithOtherApps: ctx.commandArgs.includes('--share') };
    const result = await createVolume(appId, payload);
    emit(ctx, 'success', { message: `Attached volume ${result.volume.mountPath || result.volume.containerMountPath} to ${appId}. Redeploy the app for the mount to become active.`, appId, volume: result.volume });
    return;
  }
  if (sub === 'update') {
    const id = optionValue('--id', ctx.commandArgs) || ctx.commandArgs[2];
    const size = sizeToMiB(optionValue('--size', ctx.commandArgs));
    if (!id || !Number.isInteger(size)) printError(ctx, 'quickstack volumes update <app> <volume-id> --size <MiB|Gi>');
    const result = await updateVolume(appId, { id, size });
    emit(ctx, 'success', { message: `Updated volume ${id} to ${size} MiB.`, appId, volume: result.volume });
    return;
  }
  if (sub === 'remove' || sub === 'rm' || sub === 'destroy') {
    const payload = optionValue('--id', ctx.commandArgs) ? { id: optionValue('--id', ctx.commandArgs) } : { containerMountPath: optionValue('--mount-path', ctx.commandArgs) || optionValue('--path', ctx.commandArgs) || ctx.commandArgs[2] };
    if (!payload.id && !payload.containerMountPath) printError(ctx, 'quickstack volumes destroy requires <volumeId|mount-path>, --id <volumeId>, or --mount-path <container-path>.');
    const result = await destroyVolume(appId, payload);
    emit(ctx, 'success', { message: `Detached volume from ${appId}. Redeploy the app for the detach to take effect.`, appId, removed: result.removed });
    return;
  }
  printError(ctx, 'Usage: quickstack volumes <list|show|create|update|destroy> <app> [volume] [--size <MiB|Gi>] [--json]');
}
