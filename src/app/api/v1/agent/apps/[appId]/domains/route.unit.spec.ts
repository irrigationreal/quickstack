const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn(), appScopeDenial: vi.fn(), appScopeDenialMessage: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const domainMocks = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authzMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/agent-domain.service', () => ({ default: domainMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authzMocks);

import { DELETE, GET, POST } from './route';

function request(method = 'GET', body?: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/domains', {
        method,
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent app domains route', () => {
    const app = { id: 'app-1', projectId: 'proj-1', name: 'App' };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        apiKeyMocks.appScopeDenial.mockReturnValue({ ownership: { appId: 'app-1', projectId: 'proj-1' }, remediation: 'Re-issue with a wider scope or use a different token.' });
        apiKeyMocks.appScopeDenialMessage.mockReturnValue("App app-1 is in project proj-1, which is not included in this token's scope.");
        appMocks.getById.mockResolvedValue(app);
        domainMocks.list.mockResolvedValue({ app, domains: [{ id: 'domain-1', hostname: 'app.example.com', isPrimary: true, certState: { status: 'issued' } }] });
        domainMocks.add.mockResolvedValue({ id: 'domain-2', hostname: 'www.example.com', isPrimary: false, certState: { status: 'pending' } });
        domainMocks.remove.mockResolvedValue({ id: 'domain-2', hostname: 'www.example.com' });
    });

    it('lists domains with cert state', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.domains[0].certState.status).toBe('issued');
    });

    it('adds a domain', async () => {
        const response = await POST(request('POST', { hostname: 'www.example.com' }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(domainMocks.add).toHaveBeenCalledWith('app-1', { hostname: 'www.example.com' });
        expect(body.domain.hostname).toBe('www.example.com');
    });

    it('removes a domain', async () => {
        const response = await DELETE(request('DELETE', { hostname: 'www.example.com' }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(domainMocks.remove).toHaveBeenCalledWith('app-1', 'www.example.com');
        expect(body.removed.hostname).toBe('www.example.com');
    });

    it('rejects missing auth', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('bad key'));
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(401);
    });

    it('rejects keys without write scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);
        const response = await POST(request('POST', { hostname: 'www.example.com' }), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(403);
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
