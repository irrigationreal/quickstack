import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type http from "node:http";
import apiKeyService from "./server/services/api-key.service";
import appService from "./server/services/app.service";
import podExecSessionService from "./server/services/pod-exec-session.service";
import auditService from "./server/services/audit.service";
import { assertSessionCanWriteApp } from "./server/utils/action-wrapper.utils";

function httpError(status: number, message: string) {
  const error = new Error(message);
  (error as any).status = status;
  return error;
}

function parseCommand(request: http.IncomingMessage) {
  const encoded = request.headers['x-quickstack-exec-command'];
  if (typeof encoded !== 'string') return { command: ['/bin/sh'], tty: true, stdinClosed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid exec stream command.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw httpError(400, 'Invalid exec stream command.');
  }
  const command = 'command' in parsed ? parsed.command : undefined;
  const tty = 'tty' in parsed ? parsed.tty : undefined;
  if (command !== undefined && (!Array.isArray(command) || command.length === 0 || command.some((item: unknown) => typeof item !== 'string' || item.length === 0))) {
    throw httpError(400, 'Invalid exec stream command.');
  }
  if (tty !== undefined && typeof tty !== 'boolean') {
    throw httpError(400, 'Invalid exec stream command.');
  }

  return {
    command: command ?? ['/bin/sh'],
    tty: tty ?? true,
    stdinClosed: request.headers['x-quickstack-stdin-closed'] === 'true',
  };
}

async function authorizeExecStream(request: http.IncomingMessage, appId: string) {
  const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.authorization ?? null);
  const app = await appService.getById(appId);
  if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) throw httpError(403, 'API key does not have app write permission.');
  if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) throw httpError(403, 'API key is not authorized to open a shell for this app.');
  try { assertSessionCanWriteApp(authenticated.session, app.id); } catch (error) { throw httpError(403, error instanceof Error ? error.message : 'API key user is not authorized for this app.'); }
  return { authenticated, app };
}

function reject(socket: import('node:net').Socket, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n${message}`);
  socket.destroy();
}

export default async function initializeWebsocket(server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>) {
  const execStreams = new WebSocketServer({ noServer: true });
  const existingUpgradeListeners = server.rawListeners('upgrade');
  server.removeAllListeners('upgrade');

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', 'http://quickstack.local');
    const match = requestUrl.pathname.match(/^\/api\/v1\/agent\/apps\/([^/]+)\/exec\/stream$/);
    if (!match) {
      for (const listener of existingUpgradeListeners) {
        listener.call(server, request, socket, head);
      }
      return;
    }

    void (async () => {
      try {
        const appId = decodeURIComponent(match[1]);
        const authorized = await authorizeExecStream(request, appId);
        const command = parseCommand(request);
        execStreams.handleUpgrade(request, socket, head, ws => {
          execStreams.emit('connection', ws, request, { app: authorized.app, actor: authorized.authenticated.auditActor, command });
        });
      } catch (error) {
        reject(socket as import('node:net').Socket, (error as any)?.status ?? 401, error instanceof Error ? error.message : 'Unauthorized');
      }
    })();
  });

  execStreams.on('connection', (ws: WebSocket, _request: http.IncomingMessage, context: any) => {
    podExecSessionService.openWebSocket({
      ws,
      appId: context.app.id,
      projectId: context.app.projectId,
      command: context.command.command,
      tty: context.command.tty,
      stdinClosed: context.command.stdinClosed,
    }).then(session => auditService.recordBestEffort({
      ...context.actor,
      action: 'AGENT_APP_EXEC_REQUESTED',
      outcome: 'SUCCESS',
      targetType: 'APP',
      targetId: context.app.id,
      projectId: context.app.projectId,
      appId: context.app.id,
      appName: context.app.name,
      message: 'WebSocket exec session opened.',
      metadata: { sessionId: session.sessionId, command: context.command.command, tty: context.command.tty },
    })).catch(error => {
      if (ws.readyState === ws.OPEN) ws.close(1011, error instanceof Error ? error.message : 'Exec stream failed');
    });
  });
}
