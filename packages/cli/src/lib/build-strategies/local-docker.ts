import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBuild, ensureApiConfig } from '../api-client';
import { configString, readQuickStackConfig } from '../state';
import type { BuildCapabilities } from '../../../../../src/shared/model/agent-build-strategy.model';
import { normalizeExistingImage } from './existing-image';

const REGISTRY_CONFIG_KEYS = {
  sshHost: 'registrySshHost',
  remoteHost: 'registrySshRemoteHost',
  remotePort: 'registrySshRemotePort',
  localUrl: 'registryLocalUrl',
} as const;

export type RegistryTunnelConfig = {
  sshHost: string;
  remoteHost: string;
  remotePort: string;
  localUrl: string;
};

type RegistryAuth = NonNullable<NonNullable<BuildCapabilities['registry']>['auth']>;

function imageRegistry(imageReference: string) {
  return normalizeExistingImage(imageReference).image.registry;
}

function isLoopbackRegistry(registry: string) {
  return /^localhost:\d+$/.test(registry) || /^127\.0\.0\.1:\d+$/.test(registry);
}

async function registryResponds(registry: string) {
  try {
    const response = await fetch(`http://${registry}/v2/`, { signal: AbortSignal.timeout(1500) });
    return response.status === 200 || response.status === 401;
  } catch {
    return false;
  }
}

export async function resolveRegistryTunnelConfig(): Promise<RegistryTunnelConfig | null> {
  const config = await readQuickStackConfig();
  const sshHost = process.env.QUICKSTACK_REGISTRY_SSH_HOST || configString(config, REGISTRY_CONFIG_KEYS.sshHost);
  if (!sshHost) return null;
  return {
    sshHost,
    remoteHost: process.env.QUICKSTACK_REGISTRY_REMOTE_HOST || configString(config, REGISTRY_CONFIG_KEYS.remoteHost) || '127.0.0.1',
    remotePort: process.env.QUICKSTACK_REGISTRY_REMOTE_PORT || configString(config, REGISTRY_CONFIG_KEYS.remotePort) || '30100',
    localUrl: process.env.QUICKSTACK_REGISTRY_LOCAL_URL || configString(config, REGISTRY_CONFIG_KEYS.localUrl) || 'localhost:30100',
  };
}

async function openRegistryTunnel(imageReference: string, tunnel: RegistryTunnelConfig | null) {
  const registry = imageRegistry(imageReference);
  if (!isLoopbackRegistry(registry) || await registryResponds(registry)) return undefined;

  if (!tunnel) {
    throw new Error(`Registry ${registry} is not reachable. Configure QUICKSTACK_REGISTRY_SSH_HOST or registrySshHost in ~/.quickstack/config.json so the CLI can open an SSH tunnel to the QuickStack registry.`);
  }

  const child = spawn('ssh', ['-N', '-L', `${registry}:${tunnel.remoteHost}:${tunnel.remotePort}`, tunnel.sshHost], { stdio: 'ignore' });
  const close = () => {
    if (!child.killed) child.kill();
  };
  await waitForTunnel(registry, child, close);
  return close;
}

async function waitForTunnel(registry: string, child: ChildProcess, close: () => void) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await registryResponds(registry)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  close();
  throw new Error(`Could not open SSH tunnel to QuickStack registry ${registry}. Check registrySshHost/QUICKSTACK_REGISTRY_SSH_HOST and SSH access.`);
}

function runDocker(args: string[], failureMessage: string, env?: Record<string, string | undefined>) {
  const result = spawnSync('docker', args, { stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env });
  if (result.status !== 0) throw new Error(failureMessage);
}

async function readDockerConfig() {
  const dockerConfigPath = path.join(process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker'), 'config.json');
  try {
    return JSON.parse(await fsp.readFile(dockerConfigPath, 'utf8')) as Record<string, any>;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function withDockerRegistryAuth<T>(imageReference: string, auth: RegistryAuth | undefined, callback: (env?: Record<string, string | undefined>) => Promise<T>) {
  if (!auth || auth.type !== 'token') {
    return await callback();
  }
  const { apiKey } = await ensureApiConfig();
  const registry = imageRegistry(imageReference);
  const dockerConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quickstack-docker-config-'));
  const cleanupSync = () => { fs.rmSync(dockerConfigDir, { recursive: true, force: true }); };
  const signalHandler = (signal: NodeJS.Signals) => {
    cleanupSync();
    process.off(signal, signalHandler);
    process.kill(process.pid, signal);
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  try {
    const existingConfig = await readDockerConfig();
    await fsp.writeFile(path.join(dockerConfigDir, 'config.json'), JSON.stringify({
      ...existingConfig,
      auths: {
        ...(existingConfig.auths || {}),
        [registry]: { auth: Buffer.from(`quickstack:${apiKey}`).toString('base64') },
      },
    }));
    return await callback({ DOCKER_CONFIG: dockerConfigDir });
  } finally {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    cleanupSync();
  }
}

export async function runLocalDocker(appId: string, contextPath: string, imageReference: string, options: { dockerfile?: string; target?: string; platform?: string; buildArgs?: string[]; buildSecrets?: string[]; tunnel?: RegistryTunnelConfig | null; registryAuth?: RegistryAuth } = {}) {
  const tunnel = options.registryAuth ? null : options.tunnel ?? await resolveRegistryTunnelConfig();
  const closeTunnel = await openRegistryTunnel(imageReference, tunnel);
  try {
    return await withDockerRegistryAuth(imageReference, options.registryAuth, async (dockerEnv) => {
      const args = ['build', '-t', imageReference];
      if (options.dockerfile) args.push('-f', path.isAbsolute(options.dockerfile) ? options.dockerfile : path.resolve(contextPath, options.dockerfile));
      if (options.target) args.push('--target', options.target);
      if (options.platform) args.push('--platform', options.platform);
      for (const buildArg of options.buildArgs || []) args.push('--build-arg', buildArg);
      for (const buildSecret of options.buildSecrets || []) args.push('--secret', buildSecret.includes('=') ? buildSecret : `id=${buildSecret}`);
      args.push(contextPath);
      runDocker(args, 'docker build failed.', dockerEnv);
      runDocker(['push', imageReference], 'docker push failed.', dockerEnv);
      return createBuild(appId, { kind: 'local-docker-finalize', imageReference, sourceProvenance: contextPath, buildSecrets: options.buildSecrets || [] });
    });
  } finally {
    closeTunnel?.();
  }
}
