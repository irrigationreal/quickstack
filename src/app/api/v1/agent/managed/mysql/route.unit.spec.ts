const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({
    getById: vi.fn(),
    buildAndDeploy: vi.fn(),
}));
const managedMocks = vi.hoisted(() => ({
    createMysql: vi.fn(),
    attachMysql: vi.fn(),
    listMysql: vi.fn(),
    destroyMysql: vi.fn(),
    getManagedStatus: vi.fn(),
    normalizeManagedService: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));
const roleMocks = vi.hoisted(() => ({ sessionCanCreateNewAppsForProject: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/quickstack-managed-service', () => ({ default: managedMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));
vi.mock('@/shared/utils/role.utils', () => ({ UserGroupUtils: roleMocks }));

import { GET, POST } from './route';

function request(method: string, body?: Record<string, unknown>, query = '') {
    return new Request(`http://quickstack.test/api/v1/agent/managed/mysql${query}`, {
        method,
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent managed mysql route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
        auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' },
    };
    const mysqlApp = { id: 'mysql-1', projectId: 'proj-1', name: 'mysql-main', appType: 'MYSQL' };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        roleMocks.sessionCanCreateNewAppsForProject.mockReturnValue(true);
        appMocks.getById.mockResolvedValue(mysqlApp);
        appMocks.buildAndDeploy.mockResolvedValue({ deploymentId: 'dep-1' });
        managedMocks.getManagedStatus.mockResolvedValue({ id: 'mysql-1', family: 'mysql', projectId: 'proj-1', name: 'mysql-main', status: 'healthy', connection: { databaseName: 'appdb', hostname: 'svc-mysql-1', port: 3306 } });
        managedMocks.createMysql.mockResolvedValue({ mysqlApp, databaseInfo: { databaseName: 'appdb', hostname: 'svc-mysql-1', port: 3306, internalConnectionUrl: 'mysql://redacted' } });
        managedMocks.normalizeManagedService.mockReturnValue({ id: 'mysql-1', family: 'mysql', projectId: 'proj-1', name: 'mysql-main', status: 'healthy', connection: { databaseName: 'appdb', hostname: 'svc-mysql-1', port: 3306 } });
    });

    it('loads and authorizes the managed app before returning status by id', async () => {
        const response = await GET(request('GET', undefined, '?id=mysql-1'));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.getById).toHaveBeenCalledWith('mysql-1');
        expect(apiKeyMocks.isAllowedForApp).toHaveBeenCalledWith(authenticated.apiKey, mysqlApp);
        expect(managedMocks.getManagedStatus).toHaveBeenCalledWith('mysql', 'mysql-1');
        expect(json.service.connection).toEqual({ databaseName: 'appdb', hostname: 'svc-mysql-1', port: 3306 });
    });

    it('rejects status by id before exposing connection metadata when the key cannot access the app', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);

        const response = await GET(request('GET', undefined, '?id=mysql-1'));

        expect(response.status).toBe(403);
        expect(managedMocks.getManagedStatus).not.toHaveBeenCalled();
    });

    it('returns a clean 400 JSON response for invalid create payloads', async () => {
        const response = await POST(request('POST', { projectId: '' }));
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ status: 'error', message: 'Invalid managed MySQL payload.' });
        expect(managedMocks.createMysql).not.toHaveBeenCalled();
    });
});
