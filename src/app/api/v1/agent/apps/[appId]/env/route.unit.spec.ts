const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn(), save: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { GET, POST } from './route';

function request(method = 'GET', body?: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/env', { method, headers: { authorization: 'Bearer qstk_prefix_secret' }, body: body ? JSON.stringify(body) : undefined });
}

describe('agent app env route', () => {
    const authenticated = { session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com', apiKeyId: 'key-1' } };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App', envVars: 'PUBLIC_URL=https://example.com\nFEATURE_FLAG=true' });
        appMocks.save.mockResolvedValue({ id: 'app-1' });
    });

    it('lists public env values', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.env).toEqual([
            { name: 'PUBLIC_URL', value: 'https://example.com' },
            { name: 'FEATURE_FLAG', value: 'true' },
        ]);
    });

    it('sets and unsets env vars', async () => {
        const response = await POST(request('POST', { env: { API_BASE: 'https://api.example.com' }, unset: ['FEATURE_FLAG'] }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.save).toHaveBeenCalledWith({ id: 'app-1', envVars: 'API_BASE=https://api.example.com\nPUBLIC_URL=https://example.com' }, false);
        expect(body.env).toEqual([
            { name: 'API_BASE', value: 'https://api.example.com' },
            { name: 'PUBLIC_URL', value: 'https://example.com' },
        ]);
    });

    it('rejects invalid env names', async () => {
        const response = await POST(request('POST', { env: { 'BAD-NAME': 'value' } }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(400);
        expect(appMocks.save).not.toHaveBeenCalled();
    });
});
