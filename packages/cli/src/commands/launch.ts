import path from 'node:path';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { deployImage, getMe, request } from '../lib/api-client';
import { emit } from '../lib/output';
import { readProjectState, writeProjectApp, writeProjectIndex } from '../lib/state';
import { executeBuildStrategy } from './build';
import { createPlan } from './plan';

async function resolveLaunchProjectId(root: string, explicit?: string) {
  if (explicit) return explicit;
  const state = await readProjectState(root);
  if (state.index?.lastProjectId) return state.index.lastProjectId;
  if (state.apps.length === 1 && state.apps[0]?.projectId) return state.apps[0].projectId;
  const me = await getMe();
  if (me.projects.length === 1) return me.projects[0].id;
  throw new Error('No QuickStack project is available. Pass --project <projectId>.');
}

export async function launch(ctx: CliContext) {
  const root = path.resolve(positionalArgs(ctx.commandArgs)[0] || process.cwd());
  if (ctx.commandArgs.includes('--plan') || ctx.commandArgs.includes('--dry-run')) {
    const result = await createPlan(ctx, root);
    emit(ctx, result.plan.questions.length > 0 ? 'question' : 'success', {
      message: `${result.plan.framework || 'Unknown'} app at ${result.plan.serviceRoot}; strategies: ${result.plan.buildStrategies.map(item => item.strategy).join(', ') || 'none'}.`,
      plan: result.plan,
      questions: result.plan.questions.map(question => ({ id: question.id, message: question.prompt, options: question.options })),
      warnings: result.plan.warnings.map(warning => warning.message),
    });
    return;
  }
  const image = optionValue('--image', ctx.commandArgs);
  const projectId = await resolveLaunchProjectId(root, optionValue('--project', ctx.commandArgs));
  const name = optionValue('--name', ctx.commandArgs) || path.basename(root);
  const planResult = await createPlan(ctx, root);
  const hasDockerfile = planResult.plan.evidence.some(item => item.kind === 'dockerfile');
  const requestedStrategy = optionValue('--build-strategy', ctx.commandArgs) || (image ? 'existing-image' : 'source-tar');
  const mode = image || requestedStrategy === 'existing-image' || requestedStrategy === 'local-docker' ? 'image' : hasDockerfile ? 'dockerfile' : 'static';
  const payload: any = { projectId, name, image: image || 'quickstack/pending-build:latest', mode, plan: planResult.plan, port: planResult.plan.ports[0] ?? 80 };
  const result: any = await request('/api/v1/agent/apps/ensure', { method: 'POST', body: JSON.stringify(payload) });
  const appId = result.appId || result.app?.id || result.id;
  let deployment;
  let buildResult;
  if (appId) {
    const build = await executeBuildStrategy(ctx, appId, root, projectId);
    buildResult = build.buildResult;
    deployment = buildResult ? await deployImage(appId, buildResult) : undefined;
  }
  const app = { appId, projectId, name, serviceRoot: planResult.plan.serviceRoot || '.', mode, image: buildResult ? { reference: buildResult.imageReference, managed: buildResult.strategy !== 'existing-image' } : image ? { reference: image, managed: false } : undefined, updatedAt: new Date().toISOString() };
  await writeProjectIndex(root, { projectId, apps: [app.appId], updatedAt: app.updatedAt });
  await writeProjectApp(root, app);
  emit(ctx, 'success', { message: deployment ? `QuickStack app ${name} is linked and deployment requested.` : `QuickStack app ${name} is linked locally.`, app, result, buildResult, deployment });
}
