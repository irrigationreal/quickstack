import { CliContext } from '../lib/args';
import { streamLogs } from '../lib/api-client';
import { printError } from '../lib/output';
import { remoteRead } from './remote-read';

export async function logs(ctx: CliContext) {
  if (!ctx.commandArgs.includes('--follow')) return remoteRead(ctx, 'logs');
  const appId = ctx.commandArgs.find(arg => !arg.startsWith('-'));
  if (!appId) printError(ctx, 'Usage: quickstack logs <appId> --follow [--tail <lines>]');
  const body = await streamLogs(appId);
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value));
  }
}
