import { CliContext, positionalArgs } from '../lib/args';
import { listDomains } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

export async function certs(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'status';
  if (sub !== 'status') printError(ctx, 'Usage: quickstack certs status <app> [--json]');
  const appArg = positionalArgs(ctx.commandArgs.slice(1))[0];
  if (!appArg) printError(ctx, 'Usage: quickstack certs status <app> [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const result = await listDomains(appId);
  const certs = result.domains.map(domain => ({ id: domain.id, hostname: domain.hostname, certState: domain.certState }));
  emit(ctx, 'success', { message: `Fetched certificate status for ${certs.length} domain(s).`, appId, certs });
}
