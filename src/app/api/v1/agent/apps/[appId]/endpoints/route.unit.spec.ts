const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn(), appScopeDenial: vi.fn(), appScopeDenialMessage: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getExtendedById: vi.fn() }));
const endpointMocks = vi.hoisted(() => ({ saveAndReconcileForApp: vi.fn(), deleteAndReconcileForApp: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authzMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/public-endpoint.service', () => ({ default: endpointMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authzMocks);

import { DELETE, GET, POST } from './route';

function request(method = 'GET', body?: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/endpoints', {
        method,
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent app endpoints route', () => {
    const app = {
        id: 'app-1',
        projectId: 'proj-1',
        name: 'App',
        appDomains: [{ id: 'domain-1', port: 3000, hostname: 'app.example.com' }],
        appPublicEndpoints: [{ id: 'ep-1', appId: 'app-1', publicIp: '65.21.9.20', publicPort: 443, targetPort: 3000, protocol: 'TCP', sourceCidrsJson: '["0.0.0.0/0"]', proxyProtocol: false, enabled: true, status: 'ACTIVE' }],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        apiKeyMocks.appScopeDenial.mockReturnValue({ ownership: { appId: 'app-1', projectId: 'proj-1' }, remediation: 'Re-issue with a wider scope or use a different token.' });
        apiKeyMocks.appScopeDenialMessage.mockReturnValue("App app-1 is in project proj-1, which is not included in this token's scope.");
        appMocks.getExtendedById.mockResolvedValue(app);
        endpointMocks.saveAndReconcileForApp.mockResolvedValue({ ...app.appPublicEndpoints[0], id: 'ep-2', publicPort: 8443 });
    });

    it('lists endpoints with richer metadata', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.endpoints[0]).toEqual(expect.objectContaining({ port: 3000, protocol: 'tcp', visibility: 'public', attachedDomainId: 'domain-1' }));
    });

    it('reserves an endpoint', async () => {
        const response = await POST(request('POST', { publicIp: '65.21.9.20', publicPort: 8443, targetPort: 3000, protocol: 'TCP', sourceCidrsText: '', enabled: true }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(endpointMocks.saveAndReconcileForApp).toHaveBeenCalled();
        expect(body.endpoint.publicPort).toBe(8443);
    });

    it('releases an endpoint', async () => {
        const response = await DELETE(request('DELETE', { id: 'ep-1' }), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(200);
        expect(endpointMocks.deleteAndReconcileForApp).toHaveBeenCalledWith('ep-1');
    });

    it('rejects missing auth', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('bad key'));
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(401);
    });

    it('rejects keys without read scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(403);
    });

    it('rejects endpoint mutations without write scope', async () => {
        apiKeyMocks.hasScope.mockImplementation((_key, scope) => scope === 'apps:read');
        const response = await POST(request('POST', { publicIp: '65.21.9.20', publicPort: 8443, targetPort: 3000, protocol: 'TCP', sourceCidrsText: '', enabled: true }), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(403);
        expect(endpointMocks.saveAndReconcileForApp).not.toHaveBeenCalled();
    });

    it('returns scope context for out-of-scope apps', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(403);
        expect(body.ownership).toEqual(expect.objectContaining({ appId: 'app-1', projectId: 'proj-1' }));
        expect(body.remediation).toContain('wider scope');
    });
});
