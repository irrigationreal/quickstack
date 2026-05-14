import { once } from 'node:events';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { CliContext, positionalArgs } from '../lib/args';
import { closeProxy, connectProxy, listProxySessions, openProxy } from '../lib/api-client';
import { resolveApp } from './apps';
import { emit, printError } from '../lib/output';

function parseBind(value: string) {
  const [local, remote] = value.split(':');
  const remotePort = Number(remote);
  if (!local || !Number.isInteger(remotePort)) throw new Error('Proxy binding must look like <local_port>:<remote_port>.');
  return { localBind: `127.0.0.1:${local}`, remotePort };
}

export async function proxy(ctx: CliContext) {
  const sub = ctx.commandArgs[0];
  if (sub === 'list' || sub === 'sessions') {
    const appArg = positionalArgs(ctx.commandArgs.slice(1))[0];
    if (!appArg) printError(ctx, 'Usage: quickstack proxy list <app> [--json]');
    const app = await resolveApp(appArg);
    const result = await listProxySessions(app.id);
    emit(ctx, 'success', { message: `Fetched ${result.sessions.length} proxy session(s) for ${app.id}.`, appId: app.id, sessions: result.sessions });
    return;
  }
  if (sub === 'close' || sub === 'kill') {
    const args = positionalArgs(ctx.commandArgs.slice(1));
    const appArg = args[0];
    const sessionId = args[1];
    if (!appArg || !sessionId) printError(ctx, 'Usage: quickstack proxy close <app> <session-id> [--json]');
    const app = await resolveApp(appArg);
    const result = await closeProxy(app.id, sessionId);
    emit(ctx, 'success', { message: result.closed ? `Closed proxy session ${sessionId}.` : `Proxy session ${sessionId} was not active.`, appId: app.id, closed: result.closed, session: result.session });
    return;
  }
  const args = positionalArgs(ctx.commandArgs);
  const bind = args[0];
  const remoteHost = args[1];
  const appArg = args[2];
  if (!bind || !remoteHost || !appArg) printError(ctx, 'Usage: quickstack proxy <local_port:remote_port> <remote_host> <app> [--background] [--json]\n       quickstack proxy list <app> [--json]\n       quickstack proxy close <app> <session-id> [--json]');
  const app = await resolveApp(appArg);
  const appId = app.id;
  const parsed = parseBind(bind);
  if (ctx.commandArgs.includes('--background') && !process.env.QUICKSTACK_PROXY_CHILD) {
    const result = await openProxy(appId, { ...parsed, remoteHost });
    const childArgs = process.argv.slice(2).filter(arg => arg !== '--background');
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, QUICKSTACK_PROXY_CHILD: '1', QUICKSTACK_PROXY_SESSION_ID: result.session.sessionId },
    });
    child.unref();
    emit(ctx, 'success', {
      message: `Started proxy session ${result.session.sessionId} for ${parsed.localBind} -> ${remoteHost}:${parsed.remotePort} in the background.`,
      appId,
      pid: child.pid,
      session: result.session,
      sessionId: result.session.sessionId,
    });
    return;
  }
  const result = process.env.QUICKSTACK_PROXY_SESSION_ID
    ? { session: { sessionId: process.env.QUICKSTACK_PROXY_SESSION_ID, appId, localBind: parsed.localBind, remoteHost, remotePort: parsed.remotePort } }
    : await openProxy(appId, { ...parsed, remoteHost });
  const [host, port] = parsed.localBind.split(':');
  const server = net.createServer(socket => {
    connectProxy(appId, result.session.sessionId, Readable.toWeb(socket) as ReadableStream).then(body => {
      if (!body) return socket.end();
      Readable.fromWeb(body as any).pipe(socket);
    }).catch(error => socket.destroy(error));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), host, resolve);
  });
  emit(ctx, 'success', { message: `Proxy session ${result.session.sessionId} listening on ${parsed.localBind} for ${remoteHost}:${parsed.remotePort}.`, appId, session: result.session });

  const shutdown = async () => {
    server.close();
    await closeProxy(appId, result.session.sessionId).catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await once(process, 'SIGINT');
}
