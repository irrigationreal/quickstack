import path from 'node:path';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { getBuildCapabilities } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { createPlan } from './plan';
import { resolveBuildStrategy } from '../lib/build-strategies';
import { normalizeExistingImage } from '../lib/build-strategies/existing-image';
import { runLocalDocker } from '../lib/build-strategies/local-docker';
import { runRemoteBuilder } from '../lib/build-strategies/remote-builder';
import { runSourceTar } from '../lib/build-strategies/source-tar';
import { resolveApp } from './apps';

function defaultDockerImage(appId: string, registry?: string) {
  if (!registry) throw new Error('local-docker requires --image <registry/repository:tag> because the server did not advertise a registry URL.');
  return `${registry.replace(/\/$/, '')}/${appId}:quickstack-${Date.now()}`;
}

function uploadMode(plan: Awaited<ReturnType<typeof createPlan>>['plan']) {
  return plan.evidence.some(item => item.kind === 'dockerfile') ? 'dockerfile' : 'static';
}

function optionValues(name: string, args: string[]) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function buildOptions(ctx: CliContext, plan: Awaited<ReturnType<typeof createPlan>>['plan']) {
  return {
    dockerfile: optionValue('--dockerfile', ctx.commandArgs) || plan.evidence.find(item => item.kind === 'dockerfile')?.sourcePath || './Dockerfile',
    target: optionValue('--target', ctx.commandArgs),
    buildArgs: optionValues('--build-arg', ctx.commandArgs),
    buildSecrets: optionValues('--build-secret', ctx.commandArgs),
  };
}

export async function executeBuildStrategy(ctx: CliContext, appId: string, root: string, projectId?: string) {
  const image = optionValue('--image', ctx.commandArgs);
  const explicitStrategy = (optionValue('--build-strategy', ctx.commandArgs) as any) || 'auto';
  if (image && (explicitStrategy === 'auto' || explicitStrategy === 'existing-image')) {
    return { status: 'success', buildResult: normalizeExistingImage(image) };
  }
  const plan = await createPlan(ctx, root);
  const capabilities = await getBuildCapabilities(appId);
  const strategy = resolveBuildStrategy({ recommendations: plan.plan.buildStrategies, capabilities, userFlag: explicitStrategy });
  if (strategy.strategy === 'existing-image') {
    if (!image) throw new Error('existing-image requires --image <image>.');
    return { status: 'success', buildResult: normalizeExistingImage(image) };
  }
  const options = buildOptions(ctx, plan.plan);
  const serviceRoot = path.resolve(root, plan.plan.serviceRoot || '.');
  if (strategy.strategy === 'remote-builder') {
    return runRemoteBuilder(appId, { buildSecrets: options.buildSecrets });
  }
  if (strategy.strategy === 'local-docker') {
    return runLocalDocker(appId, serviceRoot, image || defaultDockerImage(appId, capabilities.registry?.url), options);
  }
  const appProjectId = projectId ?? (await resolveApp(appId)).projectId;
  return runSourceTar(appId, serviceRoot, { projectId: appProjectId, mode: uploadMode(plan.plan), dockerfilePath: options.dockerfile, serviceRoot: plan.plan.serviceRoot || '.', buildSecrets: options.buildSecrets });
}

export async function build(ctx: CliContext) {
  const appArg = optionValue('--app', ctx.commandArgs);
  if (!appArg) printError(ctx, 'Usage: quickstack build [path] --app <app> [--build-strategy auto|source-tar|local-docker|existing-image|remote-builder] [--image <ref>] [--dockerfile <path>] [--build-arg KEY=VALUE] [--build-secret id=NAME,src=path] [--target <stage>] [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const root = path.resolve(positionalArgs(ctx.commandArgs)[0] || process.cwd());
  const result: any = await executeBuildStrategy(ctx, appId, root, app.projectId);
  emit(ctx, 'success', { message: `${result.buildResult?.strategy || 'build'} completed.`, ...result });
}
