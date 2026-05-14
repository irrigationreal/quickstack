const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const sessionMocks = vi.hoisted(() => ({ open: vi.fn(), openStream: vi.fn(), close: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/pod-exec-session.service', () => ({ default: sessionMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { DELETE, POST } from './route';

function request(method = 'POST', body?: unknown, url = 'http://quickstack.test/api/v1/agent/apps/app-1/exec/stream') {
    return new Request(url, { method, headers: { authorization: 'Bearer qstk_prefix_secret' }, body: body ? JSON.stringify(body) : undefined });
}

describe('agent app exec stream route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        sessionMocks.open.mockResolvedValue({ sessionId: 'exec-1', appId: 'app-1', command: ['/bin/sh'], tty: true });
        sessionMocks.openStream.mockResolvedValue({
            session: { sessionId: 'exec-1', appId: 'app-1', command: ['echo', 'hi'], tty: false },
            stream: new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('hi\n'));
                    controller.close();
                },
            }),
        });
        sessionMocks.close.mockReturnValue({ sessionId: 'exec-1' });
    });

    it('opens a heartbeat-driven stream session', async () => {
        const response = await POST(request('POST', { command: ['/bin/sh'], tty: true }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.heartbeat.fixedTimeout).toBe(false);
        expect(body.session.sessionId).toBe('exec-1');
    });

    it('brokers streaming exec bytes when command metadata is sent in headers', async () => {
        const response = await POST(new Request('http://quickstack.test/api/v1/agent/apps/app-1/exec/stream', {
            method: 'POST',
            headers: {
                authorization: 'Bearer qstk_prefix_secret',
                'content-type': 'application/octet-stream',
                'x-quickstack-exec-command': Buffer.from(JSON.stringify({ command: ['echo', 'hi'], tty: false })).toString('base64url'),
            },
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('stdin'));
                    controller.close();
                },
            }),
            duplex: 'half',
        } as RequestInit & { duplex: 'half' }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(200);
        expect(response.headers.get('x-quickstack-exec-session-id')).toBe('exec-1');
        expect(await response.text()).toBe('hi\n');
        expect(sessionMocks.openStream).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1', projectId: 'proj-1', command: ['echo', 'hi'], tty: false, stdin: expect.any(ReadableStream) }));
    });

    it('closes a stream session', async () => {
        const response = await DELETE(request('DELETE', undefined, 'http://quickstack.test/api/v1/agent/apps/app-1/exec/stream?sessionId=exec-1'), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.closed).toBe(true);
    });

    it('rejects keys without write scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);
        const response = await POST(request('POST', { command: ['/bin/sh'] }), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(403);
    });
});
