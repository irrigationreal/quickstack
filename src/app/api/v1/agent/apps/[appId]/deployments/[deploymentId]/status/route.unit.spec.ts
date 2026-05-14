const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const deploymentMocks = vi.hoisted(() => ({ getDeployment: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/deployment.service', () => ({ default: deploymentMocks }));
vi.mock('@/server/services/pod.service', () => ({ default: podMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);
vi.mock('@/server/adapter/db.client', () => ({ default: { client: { deploymentRecord: { updateMany: dbMocks.updateMany } } } }));

import { GET } from './route';

function request() {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/deployments/deploy-1/status', { headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent deployment status route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App', replicas: 1 });
        podMocks.getPodsForApp.mockResolvedValue([]);
        dbMocks.updateMany.mockResolvedValue({ count: 1 });
    });

    it('returns a healthy rollout', async () => {
        deploymentMocks.getDeployment.mockResolvedValue({ metadata: { generation: 3 }, spec: { template: { metadata: { annotations: { 'qs-deplyoment-id': 'deploy-1' } } } }, status: { observedGeneration: 3, replicas: 1, readyReplicas: 1, conditions: [{ type: 'Available', status: 'True' }] } });
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1', deploymentId: 'deploy-1' }) });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.rolloutState).toBe('healthy');
    });

    it('returns timed_out for progress deadline exceeded', async () => {
        deploymentMocks.getDeployment.mockResolvedValue({ spec: { template: { metadata: { annotations: { 'qs-deplyoment-id': 'deploy-1' } } } }, status: { replicas: 1, readyReplicas: 0, conditions: [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' }] } });
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1', deploymentId: 'deploy-1' }) });
        const body = await response.json();
        expect(body.rolloutState).toBe('timed_out');
    });

    it('returns failed for crashlooping pods', async () => {
        deploymentMocks.getDeployment.mockResolvedValue({ spec: { template: { metadata: { annotations: { 'qs-deplyoment-id': 'deploy-1' } } } }, status: { replicas: 1, readyReplicas: 0, conditions: [] } });
        podMocks.getPodsForApp.mockResolvedValue([{ status: 'CrashLoopBackOff' }]);
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1', deploymentId: 'deploy-1' }) });
        const body = await response.json();
        expect(body.rolloutState).toBe('failed');
    });

    it('does not report a pre-restart healthy rollout for a different active deployment', async () => {
        deploymentMocks.getDeployment.mockResolvedValue({ metadata: { generation: 7 }, spec: { template: { metadata: { annotations: { 'qs-deplyoment-id': 'old-deploy' } } } }, status: { observedGeneration: 7, replicas: 1, readyReplicas: 1, conditions: [{ type: 'Available', status: 'True' }] } });
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1', deploymentId: 'deploy-1' }) });
        const body = await response.json();
        expect(body.rolloutState).toBe('pending');
        expect(body.message).toContain('old-deploy');
    });

    it('waits until Kubernetes observes the restart generation', async () => {
        deploymentMocks.getDeployment.mockResolvedValue({ metadata: { generation: 8 }, spec: { template: { metadata: { annotations: { 'qs-deplyoment-id': 'deploy-1' } } } }, status: { observedGeneration: 7, replicas: 1, readyReplicas: 1, conditions: [{ type: 'Available', status: 'True' }] } });
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1', deploymentId: 'deploy-1' }) });
        const body = await response.json();
        expect(body.rolloutState).toBe('pending');
        expect(body.message).toContain('generation 8');
    });
});
