import { CliContext, positionalArgs } from '../lib/args';
import { getStorage, getStorageSnapshots } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function storage(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'show';
  const args = positionalArgs(ctx.commandArgs.slice(sub === 'show' || sub === 'snapshots' ? 1 : 0));
  const appArg = args[0];
  if (!['show', 'snapshots'].includes(sub) || !appArg) printError(ctx, 'Usage: quickstack storage <show|snapshots> <app> [--json]');
  const app = await resolveApp(appArg);

  if (sub === 'snapshots') {
    const result = await getStorageSnapshots(app.id);
    emit(ctx, 'success', {
      message: `Fetched ${result.snapshots.length} storage snapshot(s) for ${app.id}.`,
      appId: app.id,
      snapshots: result.snapshots,
    });
    return;
  }

  const result = await getStorage(app.id);
  emit(ctx, 'success', {
    message: `Fetched storage state for ${app.id}.`,
    appId: app.id,
    storage: result.storage,
    volumes: result.volumes,
  });
}
