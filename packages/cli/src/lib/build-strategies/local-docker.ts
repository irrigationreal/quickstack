import { spawnSync } from 'node:child_process';
import { createBuild } from '../api-client';

export async function runLocalDocker(appId: string, contextPath: string, imageReference: string, options: { dockerfile?: string; target?: string; buildArgs?: string[]; buildSecrets?: string[] } = {}) {
  const args = ['build', '-t', imageReference];
  if (options.dockerfile) args.push('-f', options.dockerfile);
  if (options.target) args.push('--target', options.target);
  for (const buildArg of options.buildArgs || []) args.push('--build-arg', buildArg);
  for (const buildSecret of options.buildSecrets || []) args.push('--secret', buildSecret.includes('=') ? buildSecret : `id=${buildSecret}`);
  args.push(contextPath);
  const build = spawnSync('docker', args, { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('docker build failed.');
  const push = spawnSync('docker', ['push', imageReference], { stdio: 'inherit' });
  if (push.status !== 0) throw new Error('docker push failed.');
  return createBuild(appId, { kind: 'local-docker-finalize', imageReference, sourceProvenance: contextPath, buildSecrets: options.buildSecrets || [] });
}
