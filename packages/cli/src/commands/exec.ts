import fs from 'node:fs/promises';
import path from 'node:path';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { findProjectRoot, readProjectState, selectStateForPath } from '../lib/state';
import { resolveApp } from './apps';

async function selectedExecApp(ctx: CliContext, argsBeforeSeparator: string[]) {
  const explicitApp = optionValue('--app', ctx.commandArgs);
  if (explicitApp) return { appId: (await resolveApp(explicitApp)).id };
  const appArg = positionalArgs(argsBeforeSeparator)[0];
  if (appArg) {
    const possibleRoot = path.resolve(appArg);
    const isDirectory = await fs.stat(possibleRoot).then(stat => stat.isDirectory()).catch(() => false);
    if (!isDirectory) return { appId: (await resolveApp(appArg)).id };
    const root = await findProjectRoot(possibleRoot);
    const state = await readProjectState(root);
    return selectStateForPath(state, root, possibleRoot) ?? (state.apps.length === 1 ? state.apps[0] : undefined);
  }
  const cwd = process.cwd();
  const root = await findProjectRoot(cwd);
  const state = await readProjectState(root);
  return selectStateForPath(state, root, cwd) ?? (state.apps.length === 1 ? state.apps[0] : undefined);
}

export async function exec(ctx: CliContext) {
  const separator = ctx.commandArgs.indexOf('--');
  if (separator < 0 || separator === ctx.commandArgs.length - 1) printError(ctx, 'Usage: quickstack exec [appId|path] -- <command> [args...]');
  const selected = await selectedExecApp(ctx, ctx.commandArgs.slice(0, separator));
  if (!selected?.appId) printError(ctx, 'Usage: quickstack exec [appId|path] -- <command> [args...]');
  const appId = selected.appId;
  const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/exec`, { method: 'POST', body: JSON.stringify({ command: ctx.commandArgs.slice(separator + 1) }) });
  emit(ctx, 'success', { message: `Executed remote command for ${appId}.`, appId, result });
}
