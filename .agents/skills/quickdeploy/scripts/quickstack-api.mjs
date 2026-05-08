#!/usr/bin/env node
import fs from 'node:fs/promises';

const command = process.argv[2];
const QUICKSTACK_URL = process.env.QUICKSTACK_URL?.replace(/\/$/, '');
const QUICKSTACK_API_KEY = process.env.QUICKSTACK_API_KEY;

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
    const body = await fs.readFile(tarPath);
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/upload-build`, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-tar',
        'content-length': String(body.length),
        'x-quickdeploy-metadata': JSON.stringify(metadata),
      },
    }), null, 2));
    return;
  }

  if (command === 'deploy') {
    const appId = process.argv[3];
    if (!appId) die('Usage: quickstack-api.mjs deploy <appId>');
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/deploy`, {
      method: 'POST',
    }), null, 2));
    return;
  }

  if (command === 'status' || command === 'logs' || command === 'releases' || command === 'secrets-list') {
    const appId = process.argv[3];
    if (!appId) die(`Usage: quickstack-api.mjs ${command} <appId>`);
    const endpoint = command === 'secrets-list' ? 'secrets' : command;
    console.log(JSON.stringify(await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/${endpoint}`), null, 2));
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

  if (command === 'postgres') {
    const payload = parseJsonArg(3, 'postgres payload');
    console.log(JSON.stringify(await request('/api/v1/agent/managed/postgres', {
      method: 'POST',
      body: JSON.stringify(payload),
    }), null, 2));
    return;
  }

  die('Usage: quickstack-api.mjs <me|ensure|upload|deploy|status|logs|releases|secrets-list|secrets-set|postgres> ...');
}

main().catch(error => die(error instanceof Error ? error.message : String(error)));
