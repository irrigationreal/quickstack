import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { CliContext, positionalArgs } from '../lib/args';
import { streamExec } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

async function collectStream(body: ReadableStream | null) {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function pipeToStdout(body: ReadableStream | null) {
  if (!body) return;
  const nodeStream = Readable.fromWeb(body as any);
  nodeStream.pipe(process.stdout);
  await finished(nodeStream);
}

export async function ssh(ctx: CliContext) {
  const separator = ctx.commandArgs.indexOf('--');
  const args = positionalArgs(separator >= 0 ? ctx.commandArgs.slice(0, separator) : ctx.commandArgs);
  const appArg = args[0];
  if (!appArg) printError(ctx, 'Usage: quickstack ssh <app> [-- <command>] [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  if (separator >= 0) {
    const command = ctx.commandArgs.slice(separator + 1);
    const result = await streamExec(appId, { command, tty: false }, null);
    if (ctx.json) {
      const stdout = await collectStream(result.body);
      const completion = await result.completion;
      emit(ctx, completion.exitCode === 0 ? 'success' : 'error', { message: `Command exited with code ${completion.exitCode}.`, appId, stdout, exitCode: completion.exitCode });
      if (completion.exitCode !== 0) process.exit(completion.exitCode);
      return;
    }
    await pipeToStdout(result.body);
    const completion = await result.completion;
    process.exit(completion.exitCode);
  }

  if (ctx.nonInteractive || !process.stdin.isTTY) printError(ctx, 'Interactive ssh requires a TTY. Use quickstack ssh <app> -- <command> in non-interactive shells.');
  const stdin = Readable.toWeb(process.stdin) as ReadableStream;
  const previousRawMode = process.stdin.isRaw;
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  try {
    const result = await streamExec(appId, { command: ['/bin/sh'], tty: true }, stdin);
    await pipeToStdout(result.body);
    const completion = await result.completion;
    process.exit(completion.exitCode);
  } finally {
    process.stdin.setRawMode?.(previousRawMode ?? false);
    process.stdin.pause();
  }
}
