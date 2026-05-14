const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn(), getConfig: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { GET } from './route';

function request(query = '') {
    return new Request(`http://quickstack.test/api/v1/agent/apps/app-1/config${query}`, { headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app config route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        appMocks.getConfig.mockResolvedValue({
            env: [{ name: 'PUBLIC_VALUE', value: '***' }],
            secrets: [{ name: 'DATABASE_URL', createdAt: '2026-05-13T12:00:00Z' }],
            image: 'registry/app:latest',
            replicaCount: 2,
            domains: [{ hostname: 'app.example.com' }],
            volumes: [{ containerMountPath: '/data' }],
        });
    });

    it('returns the aggregate config shape with masked values', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.getConfig).toHaveBeenCalledWith('app-1', { includeEnvValues: false });
        expect(body.config.env).toEqual([{ name: 'PUBLIC_VALUE', value: '***' }]);
        expect(body.config.secrets).toEqual([{ name: 'DATABASE_URL', createdAt: '2026-05-13T12:00:00Z' }]);
        expect(JSON.stringify(body)).not.toContain('postgres://secret');
    });

    it('only requests raw env values when explicitly authorized with write scope', async () => {
        apiKeyMocks.hasScope.mockImplementation((_apiKey, scope) => scope === 'apps:read' || scope === 'apps:write');
        appMocks.getConfig.mockResolvedValueOnce({ env: [{ name: 'PUBLIC_VALUE', value: 'raw-value' }], secrets: [], domains: [], volumes: [] });

        const response = await GET(request('?includeEnvValues=true'), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.getConfig).toHaveBeenCalledWith('app-1', { includeEnvValues: true });
        expect(body.config.env).toEqual([{ name: 'PUBLIC_VALUE', value: 'raw-value' }]);
    });

    it('rejects raw env value requests without write scope', async () => {
        apiKeyMocks.hasScope.mockImplementation((_apiKey, scope) => scope === 'apps:read');

        const response = await GET(request('?includeEnvValues=true'), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.getConfig).not.toHaveBeenCalled();
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
});
