import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { CLI_VERSION } from './version';
import { configString, readQuickStackConfig } from './state';
import type { AgentMeResponse } from '../../../../src/shared/model/agent-me.model';
import type { AgentAppListResponse } from '../../../../src/shared/model/agent-app-list.model';
import type { AgentLaunchPlan, AgentLaunchPlanRequest } from '../../../../src/shared/model/agent-launch-plan.model';
import type { BuildCapabilities, BuildCreateRequest, BuildResult } from '../../../../src/shared/model/agent-build-strategy.model';
import type { DeploymentStatus } from '../../../../src/shared/model/agent-release.model';
import type { DoctorResponse } from '../../../../src/shared/model/agent-doctor.model';

export const CHUNK_UPLOAD_THRESHOLD_BYTES = 90 * 1024 * 1024;
export const CHUNK_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

export class QuickStackApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(`QuickStack API ${status}: ${message}`);
  }
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
  if (!response.ok) throw new Error(`QuickStack API ${response.status}: ${await response.text()}`);
  return response.body;
}

export function getDoctor({ appId }: { appId?: string } = {}) {
  const query = appId ? `?appId=${encodeURIComponent(appId)}` : '';
  return request<DoctorResponse>(`/api/v1/agent/doctor${query}`);
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
