import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import WebSocket from 'ws';
import { CLI_VERSION } from './version';
import { configString, readQuickStackConfig } from './state';
import type { AgentMeResponse } from '../../../../src/shared/model/agent-me.model';
import type { AgentAppListResponse } from '../../../../src/shared/model/agent-app-list.model';
import type { AgentLaunchPlan, AgentLaunchPlanRequest } from '../../../../src/shared/model/agent-launch-plan.model';
import type { BuildCapabilities, BuildCreateRequest, BuildResult } from '../../../../src/shared/model/agent-build-strategy.model';
import type { DeploymentStatus, Release } from '../../../../src/shared/model/agent-release.model';
import type { DoctorResponse } from '../../../../src/shared/model/agent-doctor.model';
import type { ManagedServiceListResponse, ManagedServiceMutationResponse } from '../../../../src/shared/model/agent-managed-service.model';

export const CHUNK_UPLOAD_THRESHOLD_BYTES = 90 * 1024 * 1024;
export const CHUNK_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

export class QuickStackApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(`QuickStack API ${status}: ${message}`);
  }
}

function majorVersion(version: string | null) {
  const match = version?.match(/^(\d+)\./);
  return match ? Number(match[1]) : null;
}

export function warnOnServerVersionSkew(headers: Headers) {
  const serverVersion = headers.get('X-QuickStack-Server-Version');
  const serverMajor = majorVersion(serverVersion);
  const cliMajor = majorVersion(CLI_VERSION);
  if (serverMajor === null || cliMajor === null || serverMajor === cliMajor) return;
  console.warn(`warning: QuickStack CLI ${CLI_VERSION} is talking to server ${serverVersion}; major-version skew may break agent commands. Upgrade the CLI or server.`);
}

export async function apiConfig() {
  const config = await readQuickStackConfig();
  const url = (process.env.QUICKSTACK_URL || configString(config, 'url')).replace(/\/$/, '');
  const apiKey = process.env.QUICKSTACK_API_KEY || configString(config, 'apiKey');
  return { url, apiKey };
}

export async function ensureApiConfig() {
  const config = await apiConfig();
  if (!config.url) throw new Error('QUICKSTACK_URL is required for API-backed commands. Run quickstack setup, set QUICKSTACK_URL, or create ~/.quickstack/config.json.');
  if (!config.apiKey) throw new Error('QUICKSTACK_API_KEY is required for API-backed commands. Run quickstack setup, set QUICKSTACK_API_KEY, or create ~/.quickstack/config.json.');
  return config;
}

export async function request<T = any>(path: string, options: RequestInit & { duplex?: 'half' } = {}): Promise<T> {
  const { url, apiKey } = await ensureApiConfig();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'X-QuickStack-CLI-Version': CLI_VERSION,
      ...(options.body && !(options.body instanceof Buffer) ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  warnOnServerVersionSkew(response.headers);
  const text = await response.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body === 'object' && body?.message ? body.message : text;
    throw new QuickStackApiError(response.status, message, body);
  }
  return body as T;
}

export function getMe() {
  return request<AgentMeResponse>('/api/v1/agent/me');
}

export function listApps({ projectId }: { projectId?: string } = {}) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<AgentAppListResponse>(`/api/v1/agent/apps${query}`);
}

export function postLaunchPlan(payload: AgentLaunchPlanRequest) {
  return request<AgentLaunchPlan>('/api/v1/agent/launch-plan', { method: 'POST', body: JSON.stringify(payload) });
}

export function getBuildCapabilities(appId: string) {
  return request<BuildCapabilities>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/builds`);
}

export function getCachedBuildResult(appId: string, contentHash: string) {
  return request<{ status: 'hit' | 'miss'; buildResult?: BuildResult }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/builds?contentHash=${encodeURIComponent(contentHash)}`);
}

export function createBuild(appId: string, payload: BuildCreateRequest) {
  return request<{ status: string; buildResult: BuildResult }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/builds`, { method: 'POST', body: JSON.stringify(payload) });
}

export function deployImage(appId: string, buildResult: BuildResult) {
  return request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/deploy`, { method: 'POST', body: JSON.stringify({ buildResult }) });
}

export function pollDeploymentStatus(appId: string, deploymentId: string) {
  return request<DeploymentStatus>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/deployments/${encodeURIComponent(deploymentId)}/status`);
}

export async function streamLogs(appId: string, opts: { tail?: string } = {}) {
  const { url, apiKey } = await ensureApiConfig();
  const query = opts.tail ? `?tail=${encodeURIComponent(opts.tail)}` : '';
  const response = await fetch(`${url}/api/v1/agent/apps/${encodeURIComponent(appId)}/logs/stream${query}`, {
    headers: { authorization: `Bearer ${apiKey}`, 'X-QuickStack-CLI-Version': CLI_VERSION },
  });
  warnOnServerVersionSkew(response.headers);
  if (!response.ok) throw new Error(`QuickStack API ${response.status}: ${await response.text()}`);
  return response.body;
}

export function getDoctor({ appId }: { appId?: string } = {}) {
  const query = appId ? `?appId=${encodeURIComponent(appId)}` : '';
  return request<DoctorResponse>(`/api/v1/agent/doctor${query}`);
}

export function restartApp(appId: string) {
  return request<{ status: string; appId: string; projectId: string; release: Release }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/restart`, { method: 'POST' });
}

export function suspendApp(appId: string) {
  return request<{ status: string; appId: string; projectId: string; previousReplicas: number; replicas: number; readyReplicas: number | null }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/suspend`, { method: 'POST' });
}

export function resumeApp(appId: string, payload: { replicas?: number } = {}) {
  return request<{ status: string; appId: string; projectId: string; previousReplicas: number; replicas: number; readyReplicas: number | null }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/resume`, { method: 'POST', body: JSON.stringify(payload) });
}

export function destroyApp(appId: string) {
  return request<{ status: string; appId: string; projectId?: string; name?: string; deleted: boolean; message: string }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
}

export function listChecks(appId: string) {
  return request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/checks`);
}

export function getApp(appId: string) {
  return request<{ status: string; app: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}`);
}

export function getAppConfig(appId: string) {
  return request<{ status: string; appId: string; projectId: string; config: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/config`);
}

export function getRelease(appId: string, releaseId: string) {
  return request<{ status: string; appId: string; projectId: string; release: Release; deploymentRecord?: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/releases?releaseId=${encodeURIComponent(releaseId)}`);
}

export function listDomains(appId: string) {
  return request<{ status: string; domains: any[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/domains`);
}

export function addDomain(appId: string, hostname: string) {
  return request<{ status: string; domain: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/domains`, { method: 'POST', body: JSON.stringify({ hostname }) });
}

export function removeDomain(appId: string, domain: string) {
  return request<{ status: string; removed: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/domains`, { method: 'DELETE', body: JSON.stringify({ hostname: domain }) });
}

export function listEndpoints(appId: string) {
  return request<{ status: string; endpoints: any[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/endpoints`);
}

export function listIps(appId: string) {
  return request<{ status: string; ips: any[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/ips`);
}

export function listProxySessions(appId: string) {
  return request<{ status: string; appId: string; projectId: string; sessions: any[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/proxy`);
}

export function openProxy(appId: string, payload: { localBind: string; remoteHost: string; remotePort: number }) {
  return request<{ status: string; session: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/proxy`, { method: 'POST', body: JSON.stringify(payload) });
}

export function closeProxy(appId: string, sessionId: string) {
  return request<{ status: string; closed: boolean; session?: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/proxy?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function connectProxy(appId: string, sessionId: string, body: ReadableStream | NodeJS.ReadableStream) {
  const { url, apiKey } = await ensureApiConfig();
  const response = await fetch(`${url}/api/v1/agent/apps/${encodeURIComponent(appId)}/proxy?connect=1&sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'X-QuickStack-CLI-Version': CLI_VERSION, 'content-type': 'application/octet-stream' },
    body: body as any,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  warnOnServerVersionSkew(response.headers);
  if (!response.ok) throw new Error(`QuickStack API ${response.status}: ${await response.text()}`);
  return response.body;
}

export function listVolumes(appId: string) {
  return request<{ status: string; volumes: any[]; storage: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`);
}

export function getStorage(appId: string) {
  return request<{ status: string; appId: string; projectId: string; storage: any; volumes: any[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/storage`);
}

export function getStorageSnapshots(appId: string) {
  return request<{ status: string; appId: string; projectId: string; snapshots: any[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/storage/snapshots`);
}

export function getEnv(appId: string) {
  return request<{ status: string; appId: string; projectId: string; env: { name: string; value: string }[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/env`);
}

export function updateEnv(appId: string, payload: { env?: Record<string, string>; unset?: string[] }) {
  return request<{ status: string; appId: string; projectId: string; env: { name: string; value: string }[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/env`, { method: 'POST', body: JSON.stringify(payload) });
}

export function listSecrets(appId: string) {
  return request<{ status: string; appId: string; projectId: string; secrets: { name: string; createdAt?: string; updatedAt?: string }[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/secrets`);
}

export function updateSecrets(appId: string, payload: { secrets?: Record<string, string>; unset?: string[] }) {
  return request<{ status: string; appId: string; projectId: string; secrets: { name: string; createdAt?: string; updatedAt?: string }[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/secrets`, { method: 'POST', body: JSON.stringify(payload) });
}

export function getMetrics(appId: string) {
  return request<{ status: string; appId: string; projectId: string; metrics: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/metrics`);
}

export function listJobs(appId: string) {
  return request<{ status: string; appId: string; projectId: string; jobs: any[] }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/jobs`);
}

export function runJob(appId: string, payload: any = {}) {
  return request<{ status: string; appId: string; projectId: string; job?: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/jobs`, { method: 'POST', body: JSON.stringify(payload) });
}

export function showJob(appId: string, jobId: string) {
  return request<{ status: string; appId: string; projectId: string; job: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/jobs/${encodeURIComponent(jobId)}`);
}

export function cancelJob(appId: string, jobId: string) {
  return request<{ status: string; appId: string; projectId: string; cancelled: boolean; jobId: string }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

export function createVolume(appId: string, payload: any) {
  return request<{ status: string; volume: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`, { method: 'POST', body: JSON.stringify(payload) });
}

export function updateVolume(appId: string, payload: { id: string; size: number }) {
  return request<{ status: string; volume: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function destroyVolume(appId: string, payload: { id?: string; containerMountPath?: string }) {
  return request<{ status: string; removed: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`, { method: 'DELETE', body: JSON.stringify(payload) });
}

export function updateChecks(appId: string, payload: any) {
  return request<{ status: string; checks: any }>(`/api/v1/agent/apps/${encodeURIComponent(appId)}/checks`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function streamExec(appId: string, payload: { command?: string[]; tty?: boolean }, input?: ReadableStream | NodeJS.ReadableStream | null) {
  const { url, apiKey } = await ensureApiConfig();
  const wsUrl = `${url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/api/v1/agent/apps/${encodeURIComponent(appId)}/exec/stream`;
  const ws = new WebSocket(wsUrl, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'X-QuickStack-CLI-Version': CLI_VERSION,
      'x-quickstack-exec-command': Buffer.from(JSON.stringify(payload)).toString('base64url'),
      ...(!input && payload.tty === false ? { 'x-quickstack-stdin-closed': 'true' } : {}),
    },
  });
  const completion = new Promise<{ exitCode: number }>(resolve => {
    ws.once('close', (code, reason) => {
      const match = reason.toString().match(/exitCode:(\d+)/);
      resolve({ exitCode: match ? Number(match[1]) : code === 1000 ? 0 : 1 });
    });
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      ws.on('message', data => controller.enqueue(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)));
      ws.on('close', () => controller.close());
      ws.on('error', error => controller.error(error));
    },
    cancel() {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (_request, response) => reject(new Error(`QuickStack API ${response.statusCode}: ${response.statusMessage}`)));
  });

  if (input) {
    const readable = input instanceof ReadableStream ? input : Readable.toWeb(input as any);
    readable.pipeTo(new WritableStream({
      write(chunk) {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk as any);
      },
      close() {
        if (payload.tty === false && ws.readyState === WebSocket.OPEN) ws.send(Buffer.alloc(0));
      },
      abort() {
        if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'stdin aborted');
      },
    })).catch(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'stdin failed');
    });
  }

  return { body, completion };
}

export function listManaged(family: string, projectId: string) {
  return request<ManagedServiceListResponse & Record<string, unknown>>(`/api/v1/agent/managed/${encodeURIComponent(family)}?projectId=${encodeURIComponent(projectId)}`);
}

export function createManaged(family: string, payload: any) {
  return request<ManagedServiceMutationResponse & Record<string, unknown>>(`/api/v1/agent/managed/${encodeURIComponent(family)}`, { method: 'POST', body: JSON.stringify(payload) });
}

export function destroyManaged(family: string, id: string) {
  const idKey = family === 'postgres' ? 'databaseAppId' : `${family}AppId`;
  return request(`/api/v1/agent/managed/${encodeURIComponent(family)}`, { method: 'DELETE', body: JSON.stringify({ [idKey]: id }) });
}

export function getManagedStatus(family: string, id: string) {
  return request<ManagedServiceMutationResponse & Record<string, unknown>>(`/api/v1/agent/managed/${encodeURIComponent(family)}?id=${encodeURIComponent(id)}`);
}

export function attachService(appId: string, serviceId: string) {
  return request('/api/v1/agent/managed/services/attach', { method: 'POST', body: JSON.stringify({ appId, serviceId }) });
}

export function detachService(appId: string, serviceId: string) {
  return request('/api/v1/agent/managed/services/detach', { method: 'POST', body: JSON.stringify({ appId, serviceId }) });
}

export function listAttachedServices(appId: string) {
  return request(`/api/v1/agent/managed/services?appId=${encodeURIComponent(appId)}`);
}

export function listTokens() {
  return request<{ status: string; tokens: any[] }>('/api/v1/agent/tokens');
}

export function createToken(payload: { scope: unknown }) {
  return request<{ status: string; token: any; plaintextToken: string; notice: string }>('/api/v1/agent/tokens', { method: 'POST', body: JSON.stringify(payload) });
}

export function revokeToken(tokenId: string) {
  return request<{ status: string; revoked: any; message: string }>('/api/v1/agent/tokens', { method: 'DELETE', body: JSON.stringify({ tokenId }) });
}

export async function uploadBuildTar(appId: string, tarPath: string, metadata: Record<string, unknown>) {
  return uploadBuild(appId, tarPath, metadata);
}

export async function uploadBuild(appId: string, tarPath: string, metadata: Record<string, unknown>) {
  const stat = await fs.stat(tarPath);
  const uploadPath = `/api/v1/agent/apps/${encodeURIComponent(appId)}/upload-build`;
  if (stat.size <= CHUNK_UPLOAD_THRESHOLD_BYTES) {
    return request(uploadPath, {
      method: 'POST',
      body: createReadStream(tarPath) as any,
      duplex: 'half',
      headers: {
        'content-type': 'application/x-tar',
        'content-length': String(stat.size),
        'x-quickdeploy-metadata': JSON.stringify(metadata),
      },
    });
  }

  const uploadId = `qd-${crypto.randomUUID()}`;
  const chunkCount = Math.ceil(stat.size / CHUNK_UPLOAD_SIZE_BYTES);
  let lastResponse = null;
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHUNK_UPLOAD_SIZE_BYTES;
    const end = Math.min(stat.size, start + CHUNK_UPLOAD_SIZE_BYTES) - 1;
    lastResponse = await request(uploadPath, {
      method: 'POST',
      body: createReadStream(tarPath, { start, end }) as any,
      duplex: 'half',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(end - start + 1),
        'x-quickdeploy-metadata': JSON.stringify(metadata),
        'x-quickdeploy-upload-id': uploadId,
        'x-quickdeploy-chunk-index': String(index),
        'x-quickdeploy-chunk-count': String(chunkCount),
        'x-quickdeploy-total-bytes': String(stat.size),
      },
    });
  }
  return lastResponse;
}
