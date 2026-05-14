import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { readProjectState, selectStateForPath } from '../lib/state';

export async function deploy(ctx: CliContext) {
  const root = process.cwd();
  const state = await readProjectState(root);
  const explicit = optionValue('--app', ctx.commandArgs) || positionalArgs(ctx.commandArgs)[0];
  const selected = explicit ? { appId: explicit } : selectStateForPath(state, root, root);
  if (!selected?.appId) printError(ctx, 'Usage: quickstack deploy [path] [--app <id>] [--json]');
  const result = await request(`/api/v1/agent/apps/${encodeURIComponent(selected.appId)}/deploy`, { method: 'POST' });
  emit(ctx, 'success', { message: `Deployment requested for ${selected.appId}.`, appId: selected.appId, deployment: result });
}
