const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));

const appMocks = vi.hoisted(() => ({
    getById: vi.fn(),
    save: vi.fn(),
    buildAndDeploy: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({
    recordBestEffort: vi.fn(),
}));

const watchMocks = vi.hoisted(() => ({
    buildStartWatch: vi.fn(),
    deploymentStartWatch: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({ update: vi.fn() }));

const authMocks = vi.hoisted(() => ({
    assertSessionCanWriteApp: vi.fn(),
}));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/adapter/db.client', () => ({ default: { client: { deploymentRecord: { update: dbMocks.update } } } }));
vi.mock('@/server/services/standalone-services/build-watch.service', () => ({ default: { startWatch: watchMocks.buildStartWatch } }));
vi.mock('@/server/services/standalone-services/deployment-event-watch.service', () => ({ default: { startWatch: watchMocks.deploymentStartWatch } }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));

import { GET, POST } from './route';

describe('agent deploy route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
        auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', name: 'Demo App', projectId: 'project-1' });
        appMocks.buildAndDeploy.mockResolvedValue({ deploymentId: 'deployment-1' });
        dbMocks.update.mockResolvedValue({ deploymentId: 'deployment-1' });
        authMocks.assertSessionCanWriteApp.mockReturnValue(authenticated.session);
    });

    it('rejects GET requests', async () => {
        const response = await GET();
        expect(response.status).toBe(405);
    });

    it('returns 401 without a valid bearer key', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('bad key'));

        const response = await POST(new Request('http://quickstack.test/api/v1/agent/apps/app-1/deploy', { method: 'POST' }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(401);
        expect(appMocks.buildAndDeploy).not.toHaveBeenCalled();
    });

    it('returns 403 and does not deploy when user lacks app write permission', async () => {
        authMocks.assertSessionCanWriteApp.mockImplementation(() => { throw new Error('forbidden'); });

        const response = await POST(new Request('http://quickstack.test/api/v1/agent/apps/app-1/deploy', {
            method: 'POST',
            headers: { authorization: 'Bearer qstk_prefix_secret' },
        }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.buildAndDeploy).not.toHaveBeenCalled();
        expect(auditMocks.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({
            action: 'AGENT_DEPLOY_REQUESTED',
            outcome: 'DENIED',
            apiKeyId: 'key-1',
        }));
    });

    it('deploys with an API_KEY actor for an authorized request', async () => {
        const response = await POST(new Request('http://quickstack.test/api/v1/agent/apps/app-1/deploy', {
            method: 'POST',
            headers: { authorization: 'Bearer qstk_prefix_secret' },
        }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(200);
        expect(appMocks.buildAndDeploy).toHaveBeenCalledWith('app-1', true, expect.objectContaining({
            actorType: 'API_KEY',
            apiKeyId: 'key-1',
        }));
    });

    it('deploys a normalized build result by updating the app image first', async () => {
        const buildResult = {
            image: { registry: 'registry.example', repository: 'app', tag: 'local' },
            imageReference: 'registry.example/app:local',
            strategy: 'local-docker',
            sourceProvenance: 'local-docker',
            cacheHit: false,
        };
        const response = await POST(new Request('http://quickstack.test/api/v1/agent/apps/app-1/deploy', {
            method: 'POST',
            headers: { authorization: 'Bearer qstk_prefix_secret' },
            body: JSON.stringify({ buildResult }),
        }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.save).toHaveBeenCalledWith({ id: 'app-1', containerImageSource: 'registry.example/app:local', sourceType: 'CONTAINER' }, false);
        expect(dbMocks.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { deploymentId: 'deployment-1' },
            data: expect.objectContaining({ buildStrategy: 'local-docker', imageReference: 'registry.example/app:local' }),
        }));
        expect(body.buildResult).toEqual(buildResult);
    });
});
