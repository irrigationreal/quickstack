#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { configString, readQuickStackConfig } from './config.mjs';

const command = process.argv[2];
const config = await readQuickStackConfig();
const QUICKSTACK_URL = (process.env.QUICKSTACK_URL || configString(config, 'url')).replace(/\/$/, '');
const QUICKSTACK_API_KEY = process.env.QUICKSTACK_API_KEY || configString(config, 'apiKey');

function die(message) {
  console.error(message);
  process.exit(1);
}

if (!QUICKSTACK_URL) die('QUICKSTACK_URL is required.');
if (!QUICKSTACK_API_KEY) die('QUICKSTACK_API_KEY is required.');

async function request(path, options = {}) {
  const response = await fetch(`${QUICKSTACK_URL}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${QUICKSTACK_API_KEY}`,
      ...(options.body && !(options.body instanceof Buffer) ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body === 'object' && body?.message ? body.message : text;
    die(`QuickStack API ${response.status}: ${message}`);
  }
  return body;
}

function parseJsonArg(index, name) {
  const value = process.argv[index];
  if (!value) die(`${name} JSON argument is required.`);
  try { return JSON.parse(value); } catch { die(`${name} must be valid JSON.`); }
}

async function main() {
  if (command === 'me') {
    console.log(JSON.stringify(await request('/api/v1/agent/me'), null, 2));
    return;
  }

  if (command === 'ensure') {
    const payload = parseJsonArg(3, 'ensure payload');
    console.log(JSON.stringify(await request('/api/v1/agent/apps/ensure', {
      method: 'POST',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'upload') {
    const appId = process.argv[3];
    const tarPath = process.argv[4];
    const metadata = parseJsonArg(5, 'upload metadata');
    if (!appId || !tarPath) die('Usage: quickstack-api.mjs upload <appId> <tarPath> <metadataJson>');
    const stat = await fs.stat(tarPath);
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/upload-build`, {
      method: 'POST',
      body: createReadStream(tarPath),
      duplex: 'half',
      headers: {
        'content-type': 'application/x-tar',
        'content-length': String(stat.size),
        'x-quickdeploy-metadata': JSON.stringify(metadata),
      },
    }), null, 2));
    return;
  }

  if (command === 'deploy' || command === 'rollback') {
    const appId = process.argv[3];
    if (!appId) die(`Usage: quickstack-api.mjs ${command} <appId>`);
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/${command}`, {
      method: 'POST',
    }), null, 2));
    return;
  }

  if (command === 'scale') {
    const appId = process.argv[3];
    const replicas = Number(process.argv[4]);
    if (!appId || !Number.isInteger(replicas)) die('Usage: quickstack-api.mjs scale <appId> <replicas>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/scale`, {
      method: 'POST',
      body: JSON.stringify({ replicas }),
    }), null, 2));
    return;
  }

  if (command === 'status' || command === 'logs' || command === 'releases' || command === 'secrets-list' || command === 'endpoints-list' || command === 'volumes-list') {
    const appId = process.argv[3];
    if (!appId) die(`Usage: quickstack-api.mjs ${command} <appId> [queryString]`);
    const endpoint = command === 'secrets-list' ? 'secrets' : command === 'endpoints-list' ? 'endpoints' : command === 'volumes-list' ? 'volumes' : command;
    const query = process.argv[4] ? `?${process.argv[4].replace(/^\?/, '')}` : '';
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/${endpoint}${query}`), null, 2));
    return;
  }

  if (command === 'endpoints-reserve') {
    const appId = process.argv[3];
    const payload = parseJsonArg(4, 'endpoint payload');
    if (!appId) die('Usage: quickstack-api.mjs endpoints-reserve <appId> <payloadJson>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/endpoints`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'endpoints-release') {
    const appId = process.argv[3];
    const payload = parseJsonArg(4, 'endpoint release payload');
    if (!appId) die('Usage: quickstack-api.mjs endpoints-release <appId> <payloadJson>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/endpoints`, {
      method: 'DELETE',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'secrets-set') {
    const appId = process.argv[3];
    const payload = parseJsonArg(4, 'secrets payload');
    if (!appId) die('Usage: quickstack-api.mjs secrets-set <appId> <payloadJson>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/secrets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'volumes-add') {
    const appId = process.argv[3];
    const payload = parseJsonArg(4, 'volume payload');
    if (!appId) die('Usage: quickstack-api.mjs volumes-add <appId> <payloadJson>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'volumes-remove') {
    const appId = process.argv[3];
    const payload = parseJsonArg(4, 'volume removal payload');
    if (!appId) die('Usage: quickstack-api.mjs volumes-remove <appId> <payloadJson>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/volumes`, {
      method: 'DELETE',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'exec') {
    const appId = process.argv[3];
    const payload = parseJsonArg(4, 'exec payload');
    if (!appId) die('Usage: quickstack-api.mjs exec <appId> <payloadJson>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/exec`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'postgres') {
    const payload = parseJsonArg(3, 'postgres payload');
    console.log(JSON.stringify(await request('/api/v1/agent/managed/postgres', {
      method: 'POST',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  if (command === 'postgres-list') {
    const projectId = process.argv[3];
    if (!projectId) die('Usage: quickstack-api.mjs postgres-list <projectId>');
    console.log(JSON.stringify(await request(`/api/v1/agent/managed/postgres?projectId=${encodeURIComponent(projectId)}`), null, 2));
    return;
  }

  if (command === 'postgres-destroy') {
    const payload = parseJsonArg(3, 'postgres destroy payload');
    console.log(JSON.stringify(await request('/api/v1/agent/managed/postgres', {
      method: 'DELETE',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  die('Usage: quickstack-api.mjs <me|ensure|upload|deploy|scale|rollback|status|logs|releases|secrets-list|secrets-set|endpoints-list|endpoints-reserve|endpoints-release|volumes-list|volumes-add|volumes-remove|exec|postgres|postgres-list|postgres-destroy> ...');
}

main().catch(error => die(error instanceof Error ? error.message : String(error)));
