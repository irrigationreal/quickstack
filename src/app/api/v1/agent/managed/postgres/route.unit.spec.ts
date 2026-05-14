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
    createPostgres: vi.fn(),
    attachPostgres: vi.fn(),
    listPostgres: vi.fn(),
    destroyPostgres: vi.fn(),
    getManagedStatus: vi.fn(),
    normalizeManagedService: vi.fn(),
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
    return new Request(`http://quickstack.test/api/v1/agent/managed/postgres${query}`, {
        method,
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent managed postgres route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
        auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' },
    };
    const databaseApp = { id: 'pg-1', projectId: 'proj-1', name: 'pg-main', appType: 'POSTGRES' };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        roleMocks.sessionCanCreateNewAppsForProject.mockReturnValue(true);
        appMocks.getById.mockResolvedValue(databaseApp);
        appMocks.buildAndDeploy.mockResolvedValue({ deploymentId: 'dep-1' });
        managedMocks.createPostgres.mockResolvedValue({
            databaseApp,
            databaseInfo: { databaseName: 'appdb', username: 'appuser', hostname: 'svc-pg-1', port: 5432, internalConnectionUrl: 'postgresql://redacted' },
        });
        managedMocks.attachPostgres.mockResolvedValue({ appId: 'app-1', databaseAppId: 'pg-1', secretName: 'DATABASE_URL', database: { databaseName: 'appdb', hostname: 'svc-pg-1', port: 5432 } });
        managedMocks.listPostgres.mockResolvedValue([{ id: 'pg-1', family: 'postgres', projectId: 'proj-1', name: 'pg-main', status: 'healthy', connection: { databaseName: 'appdb', hostname: 'svc-pg-1', port: 5432 } }]);
        managedMocks.destroyPostgres.mockResolvedValue({ databaseAppId: 'pg-1', projectId: 'proj-1', name: 'pg-main' });
        managedMocks.getManagedStatus.mockResolvedValue({ id: 'pg-1', family: 'postgres', projectId: 'proj-1', name: 'pg-main', status: 'healthy', connection: { databaseName: 'appdb', hostname: 'svc-pg-1', port: 5432 } });
        managedMocks.normalizeManagedService.mockReturnValue({ id: 'pg-1', family: 'postgres', projectId: 'proj-1', name: 'pg-main', status: 'healthy', connection: { databaseName: 'appdb', hostname: 'svc-pg-1', port: 5432 } });
    });

    it('creates and deploys a managed Postgres app before returning sanitized connection metadata', async () => {
        const response = await POST(request('POST', { projectId: 'proj-1', name: 'pg-main', attachAppId: 'app-1' }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(managedMocks.createPostgres).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', name: 'pg-main' }));
        expect(appMocks.buildAndDeploy).toHaveBeenCalledWith('pg-1', false, authenticated.auditActor);
        expect(managedMocks.attachPostgres).toHaveBeenCalledWith(expect.objectContaining({ databaseAppId: 'pg-1', appId: 'app-1', secretName: 'DATABASE_URL' }));
        expect(json.database).toEqual({ databaseName: 'appdb', hostname: 'svc-pg-1', port: 5432 });
        expect(JSON.stringify(json)).not.toContain('postgresql://');
    });

    it('lists managed Postgres databases for a project', async () => {
        const response = await GET(request('GET', undefined, '?projectId=proj-1'));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(apiKeyMocks.hasScope).toHaveBeenCalledWith(authenticated.apiKey, 'apps:read');
        expect(managedMocks.listPostgres).toHaveBeenCalledWith('proj-1');
        expect(json.databases[0]).toEqual(expect.objectContaining({ id: 'pg-1', hostname: 'svc-pg-1', port: 5432 }));
    });

    it('loads and authorizes the managed app before returning status by id', async () => {
        const response = await GET(request('GET', undefined, '?id=pg-1'));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.getById).toHaveBeenCalledWith('pg-1');
        expect(apiKeyMocks.isAllowedForApp).toHaveBeenCalledWith(authenticated.apiKey, databaseApp);
        expect(managedMocks.getManagedStatus).toHaveBeenCalledWith('postgres', 'pg-1');
        expect(json.service.connection).toEqual({ databaseName: 'appdb', hostname: 'svc-pg-1', port: 5432 });
    });

    it('rejects status by id before exposing connection metadata when the key cannot access the app', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);

        const response = await GET(request('GET', undefined, '?id=pg-1'));

        expect(response.status).toBe(403);
        expect(managedMocks.getManagedStatus).not.toHaveBeenCalled();
    });

    it('destroys a managed Postgres app through the cleanup path', async () => {
        const response = await DELETE(request('DELETE', { databaseAppId: 'pg-1' }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(authMocks.assertSessionCanWriteApp).toHaveBeenCalledWith(authenticated.session, 'pg-1');
        expect(managedMocks.destroyPostgres).toHaveBeenCalledWith({ databaseAppId: 'pg-1', actor: authenticated.auditActor });
        expect(json.destroyed.databaseAppId).toBe('pg-1');
    });
});
