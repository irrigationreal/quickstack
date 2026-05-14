import { CliContext, optionValue } from '../lib/args';
import { streamLogs } from '../lib/api-client';
import { printError } from '../lib/output';
import { remoteRead } from './remote-read';
import { resolveApp } from './apps';

export async function logs(ctx: CliContext) {
  if (!ctx.commandArgs.includes('--follow')) return remoteRead(ctx, 'logs');
  const appArg = ctx.commandArgs.find(arg => !arg.startsWith('-'));
  if (!appArg) printError(ctx, 'Usage: quickstack logs <app> --follow [--tail <lines>]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const body = await streamLogs(appId, { tail: optionValue('--tail', ctx.commandArgs) });
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value));
  }
}
