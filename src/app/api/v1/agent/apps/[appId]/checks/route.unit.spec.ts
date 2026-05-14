const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn(), save: vi.fn(), restart: vi.fn() }));
const deploymentMocks = vi.hoisted(() => ({ getDeployment: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/deployment.service', () => ({ default: deploymentMocks }));
vi.mock('@/server/services/pod.service', () => ({ default: podMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { GET, PATCH } from './route';

function request(method = 'GET', body?: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/checks', { method, headers: { authorization: 'Bearer qstk_prefix_secret' }, body: body ? JSON.stringify(body) : undefined });
}

describe('agent app checks route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        appMocks.save.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', healthChechHttpGetPath: '/ready', healthCheckHttpPort: 3000, healthCheckFailureThreshold: 5, healthCheckTimeoutSeconds: 5, healthCheckPeriodSeconds: 15 });
        appMocks.restart.mockResolvedValue({ deploymentId: 'restart-1' });
        deploymentMocks.getDeployment.mockResolvedValue({ spec: { template: { spec: { containers: [{ readinessProbe: { httpGet: { path: '/healthz', port: 3000 } }, livenessProbe: { tcpSocket: { port: 3000 } } }] } } } });
        podMocks.getPodsForApp.mockResolvedValue([{ podName: 'pod-1', status: 'Running' }, { podName: 'pod-2', status: 'CrashLoopBackOff' }]);
    });

    it('returns probe config and per-pod pass state', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.checks.readiness).toEqual(expect.objectContaining({ httpGet: { path: '/healthz', port: 3000 } }));
        expect(body.pods).toEqual([
            { podName: 'pod-1', status: 'Running', passing: true },
            { podName: 'pod-2', status: 'CrashLoopBackOff', passing: false },
        ]);
    });

    it('updates health check settings', async () => {
        const response = await PATCH(request('PATCH', { path: '/ready', port: 3000, threshold: 5 }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.save).toHaveBeenCalledWith(expect.objectContaining({ healthChechHttpGetPath: '/ready', healthCheckHttpPort: 3000, healthCheckFailureThreshold: 5 }), false);
        expect(appMocks.restart).toHaveBeenCalledWith('app-1', expect.objectContaining({ actorType: 'API_KEY' }));
        expect(body.deploymentId).toBe('restart-1');
        expect(body.checks.path).toBe('/ready');
    });

    it('rejects missing auth', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('bad key'));

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(401);
    });

    it('preserves revoked-token auth timestamps', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockRejectedValue(new Error('API key has been revoked at 2026-05-14T00:01:00.000Z.'));

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.message).toContain('revoked at 2026-05-14T00:01:00.000Z');
    });

    it('rejects keys without read scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
    });

    it('rejects check mutations without write scope', async () => {
        apiKeyMocks.hasScope.mockImplementation((_key, scope) => scope === 'apps:read');

        const response = await PATCH(request('PATCH', { path: '/ready', port: 3000 }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.save).not.toHaveBeenCalled();
    });
});
