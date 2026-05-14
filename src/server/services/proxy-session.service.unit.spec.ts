const appMocks = vi.hoisted(() => ({ getExtendedById: vi.fn() }));
const dataMocks = vi.hoisted(() => ({ client: { app: { findMany: vi.fn() } } }));
const privateNetworkMocks = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock('./app.service', () => ({ default: appMocks }));
vi.mock('../adapter/db.client', () => ({ default: dataMocks }));
vi.mock('./private-network.service', () => ({ default: privateNetworkMocks }));

import proxySessionService from './proxy-session.service';

function app(id: string, appType = 'APP', port = 3000) {
    return {
        id,
        name: id,
        projectId: 'proj-1',
        appType,
        envVars: appType === 'POSTGRES' ? 'POSTGRES_DB=appdb\nPOSTGRES_USER=user\nPOSTGRES_PASSWORD=pass\n' : '',
        appPorts: [{ port }],
    };
}

describe('proxySessionService.open', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        privateNetworkMocks.createSession.mockImplementation(input => ({ sessionId: 'proxy-1', createdAt: '2026-01-01T00:00:00Z', ...input }));
    });

    it('allows proxy targets for managed services in the same project', async () => {
        appMocks.getExtendedById.mockImplementation((id: string) => Promise.resolve(id === 'pg-1' ? app('pg-1', 'POSTGRES', 5432) : app('app-1')));
        dataMocks.client.app.findMany.mockResolvedValue([{ id: 'pg-1' }]);

        const session = await proxySessionService.open('app-1', { localBind: '127.0.0.1:5433', remoteHost: 'svc-pg-1', remotePort: 5432 });

        expect(session.sessionId).toBe('proxy-1');
        expect(privateNetworkMocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1', projectId: 'proj-1', remoteHost: 'svc-pg-1', remotePort: 5432 }));
    });

    it('rejects arbitrary caller supplied TCP hosts', async () => {
        appMocks.getExtendedById.mockResolvedValue(app('app-1'));
        dataMocks.client.app.findMany.mockResolvedValue([]);

        await expect(proxySessionService.open('app-1', { localBind: '127.0.0.1:5433', remoteHost: 'example.com', remotePort: 5432 })).rejects.toThrow('Proxy target must be an app service port or managed service in the same project');
        expect(privateNetworkMocks.createSession).not.toHaveBeenCalled();
    });
});
