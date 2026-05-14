import { spawnSync } from 'node:child_process';
import { CliContext, optionValue } from '../lib/args';
import { apiConfig, getMe, listApps } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { readProjectState } from '../lib/state';
import type { AgentAppSummary } from '../../../../src/shared/model/agent-app-list.model';
import type { AgentProjectSummary } from '../../../../src/shared/model/agent-me.model';

export async function resolveProject(idOrName: string): Promise<AgentProjectSummary> {
  const me = await getMe();
  const matches = me.projects.filter(project => project.id === idOrName || project.name === idOrName);
  if (matches.length !== 1) throw new Error(matches.length === 0 ? `Project not found: ${idOrName}` : `Project is ambiguous: ${idOrName}`);
  return matches[0];
}

export async function resolveApp(idOrName: string, projectId?: string): Promise<AgentAppSummary> {
  const result = await listApps({ projectId });
  const matches = result.apps.filter(app => app.id === idOrName || app.name === idOrName);
  if (matches.length !== 1) throw new Error(matches.length === 0 ? `App not found: ${idOrName}` : `App is ambiguous: ${idOrName}`);
  return matches[0];
}

function openUrl(url: string) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const result = spawnSync(opener, args, { stdio: 'ignore' });
  return result.status === 0;
}

export async function apps(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  const projectArg = optionValue('--project', ctx.commandArgs);
  const project = projectArg ? await resolveProject(projectArg) : undefined;

  if (sub === 'list') {
    try {
      const [me, result] = await Promise.all([getMe(), listApps({ projectId: project?.id })]);
      const projectById = new Map(me.projects.map(item => [item.id, item]));
      const appsWithProject = result.apps.map(app => ({ ...app, projectName: projectById.get(app.projectId)?.name || app.projectId }));
      emit(ctx, 'success', {
        message: `Fetched ${appsWithProject.length} app(s).`,
        projects: me.projects,
        apps: appsWithProject,
      });
    } catch (error) {
      const state = await readProjectState(process.cwd());
      const cachedApps = project?.id ? state.apps.filter(app => app.projectId === project.id) : state.apps;
      if (cachedApps.length === 0) throw error;
      emit(ctx, 'success', {
        message: `Fetched ${cachedApps.length} cached app(s). Live discovery failed; run quickstack config pull when available.`,
        warnings: [error instanceof Error ? error.message : String(error)],
        apps: cachedApps,
        source: 'cache',
      });
    }
    return;
  }

  if (sub === 'show') {
    const appName = ctx.commandArgs[1];
    if (!appName) printError(ctx, 'Usage: quickstack apps show <app> [--project <id>] [--json]');
    const app = await resolveApp(appName, project?.id);
    emit(ctx, 'success', { message: `${app.name} (${app.id}) is ${app.status}.`, app });
    return;
  }

  if (sub === 'open') {
    const appName = ctx.commandArgs[1];
    if (!appName) printError(ctx, 'Usage: quickstack apps open <app> [--project <id>] [--json]');
    const app = await resolveApp(appName, project?.id);
    const config = await apiConfig();
    const url = `${config.url}/apps/${app.id}`;
    if (!config.url) printError(ctx, 'QUICKSTACK_URL or ~/.quickstack/config.json url is required to open an app URL.');
    const opened = openUrl(url);
    emit(ctx, 'success', { message: opened ? `Opened ${app.name}.` : `App URL: ${url}`, app, url, opened });
    return;
  }

  printError(ctx, 'Usage: quickstack apps <list|show|open> [--project <id>] [--json]');
}
