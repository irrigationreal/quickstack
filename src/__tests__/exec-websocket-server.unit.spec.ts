import { createServer } from 'node:http';
import WebSocket from 'ws';

const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const sessionMocks = vi.hoisted(() => ({ openWebSocket: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/pod-exec-session.service', () => ({ default: sessionMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));

import initializeWebsocket from '../websocket.server';

describe('exec stream websocket server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
    apiKeyMocks.hasScope.mockReturnValue(true);
    apiKeyMocks.isAllowedForApp.mockReturnValue(true);
    appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
    sessionMocks.openWebSocket.mockImplementation(async ({ ws }) => ws.close(1000, 'test complete'));
  });

  it('upgrades /exec/stream to a websocket and passes command metadata to the pod session service', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await initializeWebsocket(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener.');

    try {
      const commandHeader = Buffer.from(JSON.stringify({ command: ['echo', 'hi'], tty: false })).toString('base64url');
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/agent/apps/app-1/exec/stream`, {
        headers: { authorization: 'Bearer qstk_prefix_secret', 'x-quickstack-exec-command': commandHeader },
      });
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      await new Promise<void>(resolve => ws.once('close', () => resolve()));

      expect(sessionMocks.openWebSocket).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1', projectId: 'proj-1', command: ['echo', 'hi'], tty: false, stdinClosed: false, ws: expect.any(WebSocket) }));
    } finally {
      server.close();
    }
  });

  it('rejects malformed exec command headers as bad requests before opening a session', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await initializeWebsocket(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener.');

    try {
      const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/agent/apps/app-1/exec/stream`, {
          headers: { authorization: 'Bearer qstk_prefix_secret', 'x-quickstack-exec-command': 'not-json' },
        });
        ws.once('open', () => reject(new Error('Expected websocket upgrade to fail.')));
        ws.once('error', reject);
        ws.once('unexpected-response', (_request, incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', chunk => { body += chunk; });
          incoming.on('end', () => resolve({ statusCode: incoming.statusCode, body }));
        });
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Invalid exec stream command.');
      expect(sessionMocks.openWebSocket).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
