const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const monitorMocks = vi.hoisted(() => ({ getMonitoringForApp: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/monitoring.service', () => ({ default: monitorMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { GET } from './route';

function request() {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/metrics', { headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app metrics route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        monitorMocks.getMonitoringForApp.mockResolvedValue({ cpuPercent: 12, cpuAbsolutCores: 0.1, ramPercent: 20, ramAbsolutBytes: 1024 });
    });

    it('returns metrics from the monitoring service', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(monitorMocks.getMonitoringForApp).toHaveBeenCalledWith('proj-1', 'app-1');
        expect(body.metrics.resources.cpuPercent).toBe(12);
        expect(body.metrics.replicas.desired).toBeDefined();
    });

    it('fails clearly when metrics are unavailable', async () => {
        monitorMocks.getMonitoringForApp.mockRejectedValue(new Error('metrics.k8s.io not installed'));

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body.code).toBe('metrics_not_configured');
        expect(body.message).toContain('not configured');
    });
});
