const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({ getById: vi.fn(), save: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));
const deploymentMocks = vi.hoisted(() => ({ setReplicasForDeployment: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/services/deployment.service', () => ({ default: deploymentMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));
import { POST } from './route';

function request(body: Record<string, unknown>) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/scale', {
        method: 'POST',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: JSON.stringify(body),
    });
}

describe('agent app scale route', () => {
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
        authMocks.assertSessionCanWriteApp.mockReturnValue(authenticated.session);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo App', replicas: 1 });
        appMocks.save.mockResolvedValue({ id: 'app-1', replicas: 2 });
        deploymentMocks.setReplicasForDeployment.mockResolvedValue({ body: { status: { readyReplicas: 1 } } });
    });

    it('persists the desired replica count and scales the Kubernetes Deployment', async () => {
        const response = await POST(request({ replicas: 2 }), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(deploymentMocks.setReplicasForDeployment).toHaveBeenCalledWith('proj-1', 'app-1', 2);
        expect(appMocks.save).toHaveBeenCalledWith({ id: 'app-1', replicas: 2 }, false);
        expect(json.replicas).toBe(2);
        expect(json.readyReplicas).toBe(1);
    });

    it('does not persist the desired replica count if Kubernetes scaling fails', async () => {
        deploymentMocks.setReplicasForDeployment.mockRejectedValue(new Error('kubernetes unavailable'));

        await expect(POST(request({ replicas: 2 }), { params: Promise.resolve({ appId: 'app-1' }) }))
            .rejects
            .toThrow('kubernetes unavailable');

        expect(appMocks.save).not.toHaveBeenCalled();
    });

    it('skips the database write when the stored desired replica count is unchanged', async () => {
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo App', replicas: 2 });

        const response = await POST(request({ replicas: 2 }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(200);
        expect(deploymentMocks.setReplicasForDeployment).toHaveBeenCalledWith('proj-1', 'app-1', 2);
        expect(appMocks.save).not.toHaveBeenCalled();
    });

    it('rejects scale requests without deploy write scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await POST(request({ replicas: 2 }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.save).not.toHaveBeenCalled();
        expect(deploymentMocks.setReplicasForDeployment).not.toHaveBeenCalled();
    });

    it('rejects invalid replica counts before mutating app state', async () => {
        const response = await POST(request({ replicas: -1 }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(400);
        expect(appMocks.save).not.toHaveBeenCalled();
        expect(deploymentMocks.setReplicasForDeployment).not.toHaveBeenCalled();
    });
});
