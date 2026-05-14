import { CliContext } from '../lib/args';
import { pollDeploymentStatus, request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { remoteRead } from './remote-read';

export async function status(ctx: CliContext) {
  if (!ctx.commandArgs.includes('--watch')) return remoteRead(ctx, 'status');
  const appId = ctx.commandArgs.find(arg => !arg.startsWith('-'));
  if (!appId) printError(ctx, 'Usage: quickstack status <appId> --watch [--json]');
  const snapshot: any = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/status`);
  const deploymentId = snapshot.latestDeployment?.deploymentId;
  if (!deploymentId) printError(ctx, 'No latest deployment is available to watch.');
  const rollout = await pollDeploymentStatus(appId, deploymentId);
  emit(ctx, rollout.rolloutState === 'healthy' ? 'success' : 'ok', { message: rollout.message, rollout });
}
