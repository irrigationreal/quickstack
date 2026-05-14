const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn(), restart: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authzMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authzMocks);

import { POST } from './route';

function request() {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/restart', { method: 'POST', headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app restart route', () => {
    const authenticated = { session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com', apiKeyId: 'key-1' } };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        appMocks.restart.mockResolvedValue({ id: 'deploy-1', deploymentId: 'deploy-1', status: 'progressing', createdAt: '2026-05-13T12:00:00Z', healthy: false });
    });

    it('requests a rolling restart and returns the release record', async () => {
        const response = await POST(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.restart).toHaveBeenCalledWith('app-1', authenticated.auditActor);
        expect(body.release).toEqual(expect.objectContaining({ deploymentId: 'deploy-1', status: 'progressing' }));
    });

    it('rejects missing auth', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('bad key'));

        const response = await POST(request(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(401);
    });

    it('rejects keys without deploy scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await POST(request(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.restart).not.toHaveBeenCalled();
    });
});
