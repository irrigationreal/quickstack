import path from 'node:path';
import { CliContext, optionValue } from '../lib/args';
import { getBuildCapabilities } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { createPlan } from './plan';
import { resolveBuildStrategy } from '../lib/build-strategies';
import { normalizeExistingImage } from '../lib/build-strategies/existing-image';
import { runRemoteBuilder } from '../lib/build-strategies/remote-builder';

export async function build(ctx: CliContext) {
  const appId = optionValue('--app', ctx.commandArgs);
  if (!appId) printError(ctx, 'Usage: quickstack build [path] --app <appId> [--build-strategy auto|source-tar|local-docker|existing-image|remote-builder] [--image <ref>] [--json]');
  const image = optionValue('--image', ctx.commandArgs);
  if (image) {
    emit(ctx, 'success', { message: `Using existing image ${image}.`, buildResult: normalizeExistingImage(image) });
    return;
  }
  const plan = await createPlan(ctx, path.resolve(ctx.commandArgs.find(arg => !arg.startsWith('-')) || process.cwd()));
  const capabilities = await getBuildCapabilities(appId);
  const strategy = resolveBuildStrategy({ recommendations: plan.plan.buildStrategies, capabilities, userFlag: (optionValue('--build-strategy', ctx.commandArgs) as any) || 'auto' });
  if (strategy.strategy === 'remote-builder') {
    const result = await runRemoteBuilder(appId);
    emit(ctx, 'success', { message: 'Remote builder completed.', ...result });
    return;
  }
  emit(ctx, 'success', { message: `${strategy.strategy} selected.`, strategy });
}
