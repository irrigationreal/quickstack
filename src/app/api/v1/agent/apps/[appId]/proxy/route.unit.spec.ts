const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const proxyMocks = vi.hoisted(() => ({ open: vi.fn(), list: vi.fn(), close: vi.fn() }));
const authzMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/proxy-session.service', () => ({ default: proxyMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authzMocks);

import { DELETE, GET, POST } from './route';

function request(method = 'GET', body?: unknown, url = 'http://quickstack.test/api/v1/agent/apps/app-1/proxy') {
    return new Request(url, {
        method,
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent app proxy route', () => {
    const app = { id: 'app-1', projectId: 'proj-1', name: 'App' };
    const session = { sessionId: 'proxy-1', appId: 'app-1', localBind: '127.0.0.1:5433', remoteHost: 'postgres.proj-1.svc', remotePort: 5432 };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue(app);
        proxyMocks.open.mockResolvedValue(session);
        proxyMocks.list.mockReturnValue([session]);
        proxyMocks.close.mockReturnValue(session);
    });

    it('opens a tracked proxy session', async () => {
        const response = await POST(request('POST', { localBind: '127.0.0.1:5433', remoteHost: 'postgres.proj-1.svc', remotePort: 5432 }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(proxyMocks.open).toHaveBeenCalledWith('app-1', { localBind: '127.0.0.1:5433', remoteHost: 'postgres.proj-1.svc', remotePort: 5432 });
        expect(body.session.sessionId).toBe('proxy-1');
    });

    it('lists active sessions', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.sessions).toEqual([session]);
    });

    it('closes a session', async () => {
        const response = await DELETE(request('DELETE', undefined, 'http://quickstack.test/api/v1/agent/apps/app-1/proxy?sessionId=proxy-1'), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.closed).toBe(true);
        expect(proxyMocks.close).toHaveBeenCalledWith('app-1', 'proxy-1');
    });

    it('rejects keys without write scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);
        const response = await POST(request('POST', { localBind: '127.0.0.1:5433', remoteHost: 'postgres', remotePort: 5432 }), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(403);
    });

    it('preserves revoked-token auth errors', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('API key has been revoked at 2026-05-14T00:01:00.000Z.'));

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.message).toContain('revoked at 2026-05-14T00:01:00.000Z');
    });
});
