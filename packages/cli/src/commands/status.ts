import { CliContext } from '../lib/args';
import { pollDeploymentStatus, request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { remoteRead } from './remote-read';
import { resolveApp } from './apps';

const terminalStates = new Set(['healthy', 'failed', 'timed_out']);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function rolloutEventType(rolloutState: string, failed: boolean) {
  if (rolloutState === 'healthy') return 'success';
  if (failed) return 'error';
  return 'ok';
}

export async function status(ctx: CliContext) {
  if (!ctx.commandArgs.includes('--watch')) return remoteRead(ctx, 'status');
  const appArg = ctx.commandArgs.find(arg => !arg.startsWith('-'));
  if (!appArg) printError(ctx, 'Usage: quickstack status <app> --watch [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const snapshot: any = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/status`);
  const deploymentId = snapshot.latestDeployment?.deploymentId;
  if (!deploymentId) printError(ctx, 'No latest deployment is available to watch.');
  let rollout;
  do {
    rollout = await pollDeploymentStatus(appId, deploymentId);
    if (!ctx.json) console.log(`${rollout.rolloutState}: ${rollout.message}`);
    if (terminalStates.has(rollout.rolloutState)) break;
    await delay(2000);
  } while (true);
  const failed = rollout.rolloutState === 'failed' || rollout.rolloutState === 'timed_out';
  emit(ctx, rolloutEventType(rollout.rolloutState, failed), { message: rollout.message, rollout });
  if (failed) process.exit(1);
}
