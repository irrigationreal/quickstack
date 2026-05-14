import fs from 'node:fs/promises';
import path from 'node:path';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { deployImage, pollDeploymentStatus } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { findProjectRoot, readProjectState, selectStateForPath } from '../lib/state';
import { resolveApp } from './apps';
import { executeBuildStrategy } from './build';
import { createPlan } from './plan';

const DEPLOY_USAGE = 'Usage: quickstack deploy [path] [--plan|--dry-run] [--app <app>] [--build-strategy auto|source-tar|local-docker|existing-image|remote-builder] [--image <ref>] [--dockerfile <path>] [--platform linux/amd64] [--build-arg KEY=VALUE] [--build-secret id=NAME,src=path] [--target <stage>] [--json]';

function durationMs(value?: string) {
  if (!value) return 10 * 60 * 1000;
  const match = value.match(/^(\d+)(ms|s|m)?$/i);
  if (!match) return NaN;
  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  if (unit === 'ms') return amount;
  if (unit === 'm') return amount * 60 * 1000;
  return amount * 1000;
}

async function pathExists(value: string) {
  try {
    await fs.stat(value);
    return true;
  } catch {
    return false;
  }
}

export async function deploy(ctx: CliContext) {
  const positionals = positionalArgs(ctx.commandArgs);
  const explicitApp = optionValue('--app', ctx.commandArgs);
  const positional = positionals[0];
  const positionalPath = positional ? path.resolve(positional) : undefined;
  const positionalIsPath = Boolean(positionalPath && await pathExists(positionalPath));
  const requestedRoot = positionalIsPath ? positionalPath! : path.resolve(process.cwd());
  const root = await findProjectRoot(requestedRoot);
  if (ctx.commandArgs.includes('--plan') || ctx.commandArgs.includes('--dry-run')) {
    const explicitRoot = positionals[0];
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
  const explicit = explicitApp || (positionalIsPath ? undefined : positional);
  const selected = explicit ? await resolveApp(explicit).then(app => ({ appId: app.id, projectId: app.projectId })) : selectStateForPath(state, root, requestedRoot) ?? (state.apps.length === 1 ? state.apps[0] : undefined);
  if (!selected?.appId) printError(ctx, DEPLOY_USAGE);
  const build = await executeBuildStrategy(ctx, selected.appId, root, selected.projectId);
  const result: any = await deployImage(selected.appId, build.buildResult);
  if (ctx.commandArgs.includes('--wait') && result.deploymentId) {
    let latest;
    const deadline = Date.now() + durationMs(optionValue('--timeout', ctx.commandArgs));
    if (!Number.isFinite(deadline)) printError(ctx, '--timeout must be a duration like 90s or 5m.');
    while (Date.now() <= deadline) {
      latest = await pollDeploymentStatus(selected.appId, result.deploymentId);
      console.error(`${latest.rolloutState}: ${latest.message}`);
      if (['healthy', 'failed', 'timed_out'].includes(latest.rolloutState)) break;
      await new Promise(resolve => setTimeout(resolve, 1500 + Math.floor(Math.random() * 250)));
    }
    if (latest && !['healthy', 'failed', 'timed_out'].includes(latest.rolloutState)) latest = { ...latest, rolloutState: 'timed_out', message: `Timed out waiting for deployment ${result.deploymentId}.` };
    emit(ctx, latest?.rolloutState === 'healthy' ? 'success' : 'error', { message: latest?.message || `Deployment requested for ${selected.appId}.`, appId: selected.appId, deployment: result, rollout: latest });
    process.exit(latest?.rolloutState === 'healthy' ? 0 : 1);
  }
  emit(ctx, 'success', { message: `Deployment requested for ${selected.appId}.`, appId: selected.appId, deployment: result });
}
