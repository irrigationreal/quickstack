import path from 'node:path';
import fs from 'node:fs/promises';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { readProjectState, selectStateForPath } from '../lib/state';

async function selectedRemoteApp(ctx: CliContext) {
  const explicitAppId = optionValue('--app', ctx.commandArgs);
  if (explicitAppId) return { appId: explicitAppId };
  const [first] = positionalArgs(ctx.commandArgs);
  if (first) {
    const possibleRoot = path.resolve(first);
    const isDirectory = await fs.stat(possibleRoot).then(stat => stat.isDirectory()).catch(() => false);
    if (!isDirectory) return { appId: first };
    const state = await readProjectState(possibleRoot);
    return selectStateForPath(state, possibleRoot, possibleRoot, explicitAppId);
  }
  const root = process.cwd();
  const state = await readProjectState(root);
  return selectStateForPath(state, root, root, explicitAppId);
}

export async function remoteRead(ctx: CliContext, verb: 'status' | 'logs' | 'releases') {
  const selected = await selectedRemoteApp(ctx);
  if (!selected?.appId) printError(ctx, `Usage: quickstack ${verb} [appId|path] [--app <id>] [--json]`);
  const result = await request(`/api/v1/agent/apps/${encodeURIComponent(selected.appId)}/${verb}`);
  emit(ctx, 'success', { message: `Fetched ${verb} for ${selected.name || selected.appId}.`, appId: selected.appId, result });
}
