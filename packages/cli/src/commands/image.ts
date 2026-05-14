import { CliContext, positionalArgs } from '../lib/args';
import { deployImage, getApp } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { normalizeExistingImage } from '../lib/build-strategies/existing-image';
import { resolveApp } from './apps';

export async function image(ctx: CliContext) {
  const sub = ctx.commandArgs[0];
  const args = positionalArgs(ctx.commandArgs.slice(1));
  const appArg = args[0];
  const app = appArg ? await resolveApp(appArg) : undefined;
  const appId = app?.id;
  if (sub === 'show') {
    if (!appId) printError(ctx, 'Usage: quickstack image show <app> [--json]');
    const result = await getApp(appId);
    emit(ctx, 'success', { message: result.app.image ? `${appId} is running ${result.app.image}.` : `${appId} has no live image.`, appId, image: result.app.image, app: result.app });
    return;
  }
  if (sub === 'deploy') {
    const imageReference = args[1];
    if (!appId || !imageReference) printError(ctx, 'Usage: quickstack image deploy <app> <ref> [--json]');
    const buildResult = normalizeExistingImage(imageReference);
    const result = await deployImage(appId, buildResult);
    emit(ctx, 'success', { message: `Deployment requested for ${appId} using ${imageReference}.`, appId, buildResult, deployment: result });
    return;
  }
  printError(ctx, 'Usage: quickstack image <show|deploy> <app> [ref] [--json]');
}
