const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn(), save: vi.fn() }));
const deploymentMocks = vi.hoisted(() => ({ setReplicasForDeployment: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/deployment.service', () => ({ default: deploymentMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { POST } from './route';

function request(body?: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/resume', { method: 'POST', headers: { authorization: 'Bearer qstk_prefix_secret' }, body: body ? JSON.stringify(body) : undefined });
}

describe('agent app resume route', () => {
    const authenticated = { session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com', apiKeyId: 'key-1' } };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App', replicas: 0 });
        deploymentMocks.setReplicasForDeployment.mockResolvedValue({ body: { status: { readyReplicas: 1 } } });
    });

    it('resumes a suspended app to one replica by default', async () => {
        const response = await POST(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(deploymentMocks.setReplicasForDeployment).toHaveBeenCalledWith('proj-1', 'app-1', 1);
        expect(appMocks.save).toHaveBeenCalledWith({ id: 'app-1', replicas: 1 }, false);
        expect(body.replicas).toBe(1);
    });

    it('accepts an explicit replica count', async () => {
        const response = await POST(request({ replicas: 3 }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(200);
        expect(deploymentMocks.setReplicasForDeployment).toHaveBeenCalledWith('proj-1', 'app-1', 3);
    });

    it('rejects zero replicas', async () => {
        const response = await POST(request({ replicas: 0 }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(400);
        expect(deploymentMocks.setReplicasForDeployment).not.toHaveBeenCalled();
    });
});
