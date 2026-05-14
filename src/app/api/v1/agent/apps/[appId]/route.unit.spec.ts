const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn(), scopeForToken: vi.fn(), appScopeDenial: vi.fn(), appScopeDenialMessage: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn(), getApp: vi.fn(), destroy: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authzMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authzMocks);

import { DELETE, GET } from './route';

function request(method = 'GET') {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1', { method, headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app detail route', () => {
    const authenticated = { session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com', apiKeyId: 'key-1' } };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        apiKeyMocks.scopeForToken.mockReturnValue('actor');
        apiKeyMocks.appScopeDenial.mockReturnValue({ scope: 'actor', ownership: { appId: 'app-1', appName: 'App', projectId: 'proj-1' }, remediation: 'Re-issue with a wider scope or use a different token.' });
        apiKeyMocks.appScopeDenialMessage.mockReturnValue("App app-1 is in project proj-1, which is not included in this token's scope.");
        authzMocks.assertSessionCanReadApp.mockImplementation(() => undefined);
        authzMocks.assertSessionCanWriteApp.mockImplementation(() => undefined);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        appMocks.getApp.mockResolvedValue({ id: 'app-1', name: 'App', primaryUrl: 'https://app.example.com', image: 'registry/app:latest', replicas: 1, lastReleaseId: 'deploy-1' });
        appMocks.destroy.mockResolvedValue({ appId: 'app-1', projectId: 'proj-1', name: 'App', deleted: true, message: 'App destroyed.' });
    });

    it('returns the canonical app summary', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.app).toEqual(expect.objectContaining({ primaryUrl: 'https://app.example.com', image: 'registry/app:latest' }));
    });

    it('rejects app reads outside the authenticated session visibility', async () => {
        authzMocks.assertSessionCanReadApp.mockImplementation(() => { throw new Error('denied'); });

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.getApp).not.toHaveBeenCalled();
    });

    it('destroys an app idempotently', async () => {
        const response = await DELETE(request('DELETE'), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.destroy).toHaveBeenCalledWith('app-1', authenticated.auditActor);
        expect(body.deleted).toBe(true);
    });

    it('rejects missing auth', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('bad key'));

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(401);
    });

    it('rejects destroy without write scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await DELETE(request('DELETE'), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.destroy).not.toHaveBeenCalled();
    });

    it('includes token scope and app ownership context when an app is out of scope', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);
        apiKeyMocks.appScopeDenial.mockReturnValue({ scope: { project: 'proj-2' }, ownership: { appId: 'app-1', appName: 'App', projectId: 'proj-1' }, remediation: 'Re-issue with a wider scope or use a different token.' });

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.message).toContain('proj-1');
        expect(body.scope).toEqual({ project: 'proj-2' });
        expect(body.ownership).toEqual(expect.objectContaining({ appId: 'app-1', projectId: 'proj-1' }));
        expect(body.remediation).toContain('wider scope');
    });
});
