import path from 'node:path';
import { CliContext, optionValue } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { writeProjectApp, writeProjectIndex } from '../lib/state';

export async function launch(ctx: CliContext) {
  const root = path.resolve(ctx.commandArgs.find(arg => !arg.startsWith('-')) || process.cwd());
  const image = optionValue('--image', ctx.commandArgs);
  const projectId = optionValue('--project', ctx.commandArgs);
  const name = optionValue('--name', ctx.commandArgs) || path.basename(root);
  if (!projectId) printError(ctx, 'No QuickStack project is available. Pass --project <projectId>.');
  const payload: any = { projectId, name, source: image ? { type: 'image', image } : { type: 'managed' }, serviceRoot: '.', ports: [] };
  const result = await request('/api/v1/agent/apps/ensure', { method: 'POST', body: JSON.stringify(payload) });
  const app = { appId: result.app?.id || result.appId || result.id, projectId, name, serviceRoot: '.', mode: image ? 'image' : 'managed', image: image ? { reference: image, managed: false } : undefined, updatedAt: new Date().toISOString() };
  await writeProjectIndex(root, { projectId, apps: [app.appId], updatedAt: app.updatedAt });
  await writeProjectApp(root, app);
  emit(ctx, 'success', { message: `QuickStack app ${name} is linked locally.`, app, result });
}
