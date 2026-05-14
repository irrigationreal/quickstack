import { CliContext } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';

export async function apps(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  if (sub !== 'list') printError(ctx, 'Usage: quickstack apps list [--json]');
  const result = await request('/api/v1/agent/me');
  const apps = (result.projects || []).flatMap((project: any) => (project.apps || []).map((app: any) => ({ ...app, projectName: project.name })));
  emit(ctx, 'success', { message: `Fetched ${apps.length} app(s).`, projects: result.projects || [], apps });
}
