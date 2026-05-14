import { CliContext, positionalArgs } from '../lib/args';
import { pollDeploymentStatus, restartApp } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

const terminalStates = new Set(['healthy', 'failed', 'timed_out']);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function restart(ctx: CliContext) {
  const appArg = positionalArgs(ctx.commandArgs)[0];
  if (!appArg) printError(ctx, 'Usage: quickstack restart <app> [--wait] [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const result = await restartApp(appId);
  let rollout;
  if (ctx.commandArgs.includes('--wait')) {
    do {
      rollout = await pollDeploymentStatus(appId, result.release.deploymentId);
      if (!ctx.json) console.log(`${rollout.rolloutState}: ${rollout.message}`);
      if (terminalStates.has(rollout.rolloutState)) break;
      await delay(2000);
    } while (true);
  }
  const failed = rollout?.rolloutState === 'failed' || rollout?.rolloutState === 'timed_out';
  emit(ctx, failed ? 'error' : 'success', {
    message: ctx.commandArgs.includes('--wait') ? `Restart ${rollout?.rolloutState}: ${rollout?.message}` : `Restart requested for ${appId}.`,
    appId,
    release: result.release,
    rollout,
  });
  if (failed) process.exit(1);
}
