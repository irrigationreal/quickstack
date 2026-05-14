const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
const deploymentMocks = vi.hoisted(() => ({ getDeployment: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const rolloutMocks = vi.hoisted(() => ({ deploymentStatus: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);
vi.mock('@/server/services/deployment.service', () => ({ default: deploymentMocks }));
vi.mock('@/server/services/pod.service', () => ({ default: podMocks }));
vi.mock('@/server/services/deployment-record.service', () => ({ default: rolloutMocks }));
vi.mock('@/server/adapter/db.client', () => ({ default: { client: { deploymentRecord: { findMany: dbMocks.findMany, updateMany: dbMocks.updateMany } } } }));

import { GET } from './route';

function request(query = '') {
    return new Request(`http://quickstack.test/api/v1/agent/apps/app-1/releases${query}`, { headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app releases route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App', replicas: 1, containerImageSource: 'registry.example.com/app:current' });
        deploymentMocks.getDeployment.mockResolvedValue({});
        podMocks.getPodsForApp.mockResolvedValue([]);
        rolloutMocks.deploymentStatus.mockReturnValue({ rolloutState: 'healthy', message: 'Deployment is healthy.', observedAt: '2026-05-14T00:01:00Z' });
        dbMocks.updateMany.mockResolvedValue({ count: 1 });
        dbMocks.findMany.mockResolvedValue([
            {
                deploymentId: 'release-old',
                appId: 'app-1',
                projectId: 'proj-1',
                sourceType: 'CONTAINER',
                buildMethod: 'DOCKERFILE',
                buildStrategy: 'local-docker',
                imageReference: 'registry.example.com/app:old',
                imageJson: JSON.stringify({ registry: 'registry.example.com', repository: 'app', tag: 'old' }),
                sourceProvenance: '/repo',
                buildId: 'build-1',
                cacheHit: false,
                status: 'SUCCEEDED',
                gitCommitHash: null,
                createdAt: new Date('2026-05-14T00:00:00Z'),
            },
        ]);
    });

    it('reports immutable release build metadata instead of the app current image', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.releases[0].release).toEqual(expect.objectContaining({
            id: 'release-old',
            imageReference: 'registry.example.com/app:old',
            strategy: 'local-docker',
            sourceProvenance: '/repo',
            buildId: 'build-1',
            cacheHit: false,
            status: 'healthy',
            healthy: true,
        }));
        expect(body.releases[0].release.image).toEqual({ registry: 'registry.example.com', repository: 'app', tag: 'old' });
    });

    it('repairs stale running release state from Kubernetes rollout state', async () => {
        dbMocks.findMany.mockResolvedValue([
            {
                deploymentId: 'restart-1',
                appId: 'app-1',
                projectId: 'proj-1',
                sourceType: 'CONTAINER',
                buildMethod: 'DOCKERFILE',
                buildStrategy: 'existing-image',
                imageReference: 'registry.example.com/app:current',
                imageJson: JSON.stringify({ registry: 'registry.example.com', repository: 'app', tag: 'current' }),
                status: 'RUNNING',
                gitCommitHash: null,
                createdAt: new Date('2026-05-14T00:00:00Z'),
            },
        ]);

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.releases[0].release.status).toBe('healthy');
        expect(dbMocks.updateMany).toHaveBeenCalledWith({ where: { appId: 'app-1', deploymentId: 'restart-1' }, data: { status: 'SUCCESS' } });
    });

    it('rejects keys without read scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        expect(response.status).toBe(403);
    });
});
