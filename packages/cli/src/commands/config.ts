import path from 'node:path';
import { CliContext } from '../lib/args';
import { getAppConfig, getMe } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { readProjectState, writeProjectApp, writeProjectIndex } from '../lib/state';
import { resolveApp } from './apps';

function maskConfigForLocalState(config: any) {
  if (!config || typeof config !== 'object') return config;
  return {
    ...config,
    env: Array.isArray(config.env) ? config.env.map((entry: any) => ({ ...entry, value: '***' })) : config.env,
  };
}

export async function config(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'show';
  const rootArg = ctx.commandArgs.slice(1).find(arg => !arg.startsWith('-'));
  const root = path.resolve(sub === 'pull' || sub === 'repair' ? process.cwd() : rootArg || process.cwd());
  const state = await readProjectState(root);
  if (sub === 'show') {
    if (rootArg) {
      const app = await resolveApp(rootArg);
      const remote = await getAppConfig(app.id);
      emit(ctx, 'success', { message: `Fetched server config for ${app.name}.`, appId: app.id, config: remote.config });
      return;
    }
    emit(ctx, 'success', { message: 'Showing local .quickstack cache. Pass an app to read server truth.', state });
    return;
  }
  if (sub === 'validate') {
    const serializedState = JSON.stringify(state, (key, value) => key === 'secrets' ? undefined : value);
    const secretLeak = serializedState.match(/qstk_|password|token/i);
    if (secretLeak) printError(ctx, 'Local .quickstack state appears to contain secret-like material. Remove it before committing.', 2);
    emit(ctx, 'success', { message: state.index || state.apps.length > 0 ? '.quickstack state passed the secret marker check.' : 'No .quickstack state found; nothing to validate.', state });
    return;
  }
  if (sub === 'pull' || sub === 'repair') {
    const appName = rootArg;
    if (!appName) printError(ctx, `Usage: quickstack config ${sub} <app> [--json]`);
    const app = await resolveApp(appName);
    const [actor, remote] = await Promise.all([getMe().catch(() => null), getAppConfig(app.id)]);
    const existing = state.apps.find(item => item.appId === remote.appId || item.id === remote.appId);
    const pulled = {
      appId: remote.appId,
      id: remote.appId,
      projectId: remote.projectId,
      name: app.name,
      serviceRoot: remote.config?.app?.serviceRoot || existing?.serviceRoot || '.',
      config: maskConfigForLocalState(remote.config),
      pulledAt: new Date().toISOString(),
    };
    await writeProjectApp(root, pulled);
    await writeProjectIndex(root, {
      ...(state.index || {}),
      lastActor: actor?.actor,
      lastProjectId: remote.projectId,
      lastAppId: remote.appId,
      repairedAt: sub === 'repair' ? pulled.pulledAt : undefined,
    });
    emit(ctx, 'success', { message: `Pulled server config for ${app.name} into .quickstack.`, app: pulled });
    return;
  }
  printError(ctx, 'Usage: quickstack config <show|validate|pull|repair>');
}
