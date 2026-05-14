import { CliContext, positionalArgs } from '../lib/args';
import { addDomain, listDomains, removeDomain } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function domains(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  const args = positionalArgs(ctx.commandArgs.slice(1));
  const appArg = args[0];
  if (!appArg) printError(ctx, 'Usage: quickstack domains <list|add|remove> <app> [hostname] [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  if (sub === 'list') {
    const result = await listDomains(appId);
    emit(ctx, 'success', { message: `Fetched ${result.domains.length} domain(s) for ${appId}.`, appId, domains: result.domains });
    return;
  }
  if (sub === 'add') {
    const hostname = args[1];
    if (!hostname) printError(ctx, 'Usage: quickstack domains add <app> <hostname> [--json]');
    const result = await addDomain(appId, hostname);
    emit(ctx, 'success', { message: `Added ${result.domain.hostname} to ${appId}.`, appId, domain: result.domain });
    return;
  }
  if (sub === 'remove') {
    const hostname = args[1];
    if (!hostname) printError(ctx, 'Usage: quickstack domains remove <app> <hostname> [--json]');
    const result = await removeDomain(appId, hostname);
    emit(ctx, 'success', { message: `Removed ${result.removed.hostname} from ${appId}.`, appId, removed: result.removed });
    return;
  }
  printError(ctx, 'Usage: quickstack domains <list|add|remove> <app> [hostname] [--json]');
}
