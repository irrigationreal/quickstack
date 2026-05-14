import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { pollDeploymentStatus, request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { readProjectState, selectStateForPath } from '../lib/state';
import { createPlan } from './plan';

export async function deploy(ctx: CliContext) {
  const root = process.cwd();
  if (optionValue('--build-strategy', ctx.commandArgs) === 'remote-builder') {
    printError(ctx, 'remote builder is not configured on this server.', 2);
  }
  if (ctx.commandArgs.includes('--plan') || ctx.commandArgs.includes('--dry-run')) {
    const explicitRoot = ctx.commandArgs.find(arg => !arg.startsWith('-'));
    const result = await createPlan(ctx, explicitRoot || root);
    emit(ctx, result.plan.questions.length > 0 ? 'question' : 'success', {
      message: `${result.plan.framework || 'Unknown'} app at ${result.plan.serviceRoot}; strategies: ${result.plan.buildStrategies.map(item => item.strategy).join(', ') || 'none'}.`,
      plan: result.plan,
      questions: result.plan.questions.map(question => ({ id: question.id, message: question.prompt, options: question.options })),
      warnings: result.plan.warnings.map(warning => warning.message),
    });
    return;
  }
  const state = await readProjectState(root);
  const explicit = optionValue('--app', ctx.commandArgs) || positionalArgs(ctx.commandArgs)[0];
  const selected = explicit ? { appId: explicit } : selectStateForPath(state, root, root);
  if (!selected?.appId) printError(ctx, 'Usage: quickstack deploy [path] [--app <id>] [--json]');
  const result: any = await request(`/api/v1/agent/apps/${encodeURIComponent(selected.appId)}/deploy`, { method: 'POST' });
  if (ctx.commandArgs.includes('--wait') && result.deploymentId) {
    let latest;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      latest = await pollDeploymentStatus(selected.appId, result.deploymentId);
      console.error(`${latest.rolloutState}: ${latest.message}`);
      if (['healthy', 'failed', 'timed_out'].includes(latest.rolloutState)) break;
      await new Promise(resolve => setTimeout(resolve, 1500 + Math.floor(Math.random() * 250)));
    }
    emit(ctx, latest?.rolloutState === 'healthy' ? 'success' : 'error', { message: latest?.message || `Deployment requested for ${selected.appId}.`, appId: selected.appId, deployment: result, rollout: latest });
    process.exit(latest?.rolloutState === 'healthy' ? 0 : 1);
  }
  emit(ctx, 'success', { message: `Deployment requested for ${selected.appId}.`, appId: selected.appId, deployment: result });
}
