const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({ getExtendedById: vi.fn() }));
const deploymentMocks = vi.hoisted(() => ({ getDeployment: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const dataAccessMocks = vi.hoisted(() => ({ deploymentRecordFindMany: vi.fn(), quickDeployBuildFindMany: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/deployment.service', () => ({ default: deploymentMocks }));
vi.mock('@/server/services/pod.service', () => ({ default: podMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/adapter/db.client', () => ({
    default: {
        client: {
            deploymentRecord: { findMany: dataAccessMocks.deploymentRecordFindMany },
            quickDeployBuild: { findMany: dataAccessMocks.quickDeployBuildFindMany },
        },
    },
}));

import { GET } from './route';

function request() {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/status', {
        method: 'GET',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
    });
}

describe('agent app status route', () => {
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
        appMocks.getExtendedById.mockResolvedValue({
            id: 'app-1',
            name: 'Demo App',
            projectId: 'proj-1',
            sourceType: 'QUICKDEPLOY_UPLOAD',
            buildMethod: 'DOCKERFILE',
            replicas: 2,
            containerImageSource: 'registry.invalid/quickstack-managed-pending:latest',
            appPorts: [{ id: 'port-1', port: 8080 }],
            appDomains: [{ id: 'domain-1', hostname: 'demo.example.com', port: 8080 }],
        });
        deploymentMocks.getDeployment.mockResolvedValue({
            metadata: { name: 'app-1', namespace: 'proj-1' },
            spec: { template: { spec: { containers: [{ image: 'registry.internal/app-1:built' }] } } },
            status: { replicas: 2, readyReplicas: 2, updatedReplicas: 2, unavailableReplicas: 0, conditions: [] },
        });
        podMocks.getPodsForApp.mockResolvedValue([{ podName: 'pod-1', status: 'Running' }]);
        dataAccessMocks.deploymentRecordFindMany.mockResolvedValue([]);
        dataAccessMocks.quickDeployBuildFindMany.mockResolvedValue([]);
    });

    it('reports the live Deployment image instead of the bootstrap placeholder image', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.app.image).toBe('registry.internal/app-1:built');
        expect(json.health).toBe('healthy');
        expect(json.replicas.ready).toBe(2);
    });

    it('falls back to the app image when the Deployment is missing', async () => {
        deploymentMocks.getDeployment.mockRejectedValue(new Error('missing'));

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.app.image).toBe('registry.invalid/quickstack-managed-pending:latest');
        expect(json.health).toBe('missing');
    });
});
