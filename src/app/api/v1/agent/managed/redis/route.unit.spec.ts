const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({
    getById: vi.fn(),
    buildAndDeploy: vi.fn(),
}));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const managedMocks = vi.hoisted(() => ({
    createRedis: vi.fn(),
    attachRedis: vi.fn(),
    listRedis: vi.fn(),
    destroyRedis: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));
const roleMocks = vi.hoisted(() => ({ sessionCanCreateNewAppsForProject: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/services/quickstack-managed-service', () => ({ default: managedMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));
vi.mock('@/shared/utils/role.utils', () => ({ UserGroupUtils: roleMocks }));

import { DELETE, GET, POST } from './route';

function request(method: string, body?: Record<string, unknown>, query = '') {
    return new Request(`http://quickstack.test/api/v1/agent/managed/redis${query}`, {
        method,
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent managed redis route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
        auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' },
    };
    const redisApp = { id: 'redis-1', projectId: 'proj-1', name: 'redis-main', appType: 'REDIS' };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        roleMocks.sessionCanCreateNewAppsForProject.mockReturnValue(true);
        appMocks.getById.mockResolvedValue(redisApp);
        appMocks.buildAndDeploy.mockResolvedValue({ deploymentId: 'dep-1' });
        managedMocks.createRedis.mockResolvedValue({
            redisApp,
            databaseInfo: { hostname: 'svc-redis-1', port: 6379, internalConnectionUrl: 'redis://redacted' },
        });
        managedMocks.attachRedis.mockResolvedValue({ appId: 'app-1', redisAppId: 'redis-1', secretName: 'REDIS_URL', redis: { hostname: 'svc-redis-1', port: 6379 } });
        managedMocks.listRedis.mockResolvedValue([{ id: 'redis-1', projectId: 'proj-1', name: 'redis-main', hostname: 'svc-redis-1', port: 6379 }]);
        managedMocks.destroyRedis.mockResolvedValue({ redisAppId: 'redis-1', projectId: 'proj-1', name: 'redis-main' });
    });

    it('creates and deploys a managed Redis app before returning sanitized connection metadata', async () => {
        const response = await POST(request('POST', { projectId: 'proj-1', name: 'redis-main', attachAppId: 'app-1' }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(managedMocks.createRedis).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', name: 'redis-main' }));
        expect(appMocks.buildAndDeploy).toHaveBeenCalledWith('redis-1', false, authenticated.auditActor);
        expect(managedMocks.attachRedis).toHaveBeenCalledWith(expect.objectContaining({ redisAppId: 'redis-1', appId: 'app-1', secretName: 'REDIS_URL' }));
        expect(json.redis).toEqual({ hostname: 'svc-redis-1', port: 6379 });
        expect(JSON.stringify(json)).not.toContain('redis://');
    });

    it('lists managed Redis resources for a project', async () => {
        const response = await GET(request('GET', undefined, '?projectId=proj-1'));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(apiKeyMocks.hasScope).toHaveBeenCalledWith(authenticated.apiKey, 'apps:read');
        expect(managedMocks.listRedis).toHaveBeenCalledWith('proj-1');
        expect(json.redis[0]).toEqual(expect.objectContaining({ id: 'redis-1', hostname: 'svc-redis-1', port: 6379 }));
    });

    it('destroys a managed Redis app through the cleanup path', async () => {
        const response = await DELETE(request('DELETE', { redisAppId: 'redis-1' }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(authMocks.assertSessionCanWriteApp).toHaveBeenCalledWith(authenticated.session, 'redis-1');
        expect(managedMocks.destroyRedis).toHaveBeenCalledWith({ redisAppId: 'redis-1', actor: authenticated.auditActor });
        expect(json.destroyed.redisAppId).toBe('redis-1');
    });
});
