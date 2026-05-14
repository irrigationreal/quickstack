const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const k3sMocks = vi.hoisted(() => ({ readNamespacedPodLog: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/pod.service', () => ({ default: podMocks }));
vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({ default: { core: { readNamespacedPodLog: k3sMocks.readNamespacedPodLog } } }));

import { GET } from './route';

describe('agent logs stream route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        podMocks.getPodsForApp.mockResolvedValue([{ podName: 'pod-1', containerName: 'app', status: 'Running' }]);
        k3sMocks.readNamespacedPodLog.mockResolvedValue({ body: 'line one\n' });
    });

    it('sets up a streaming response with at least one chunk', async () => {
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/apps/app-1/logs/stream', { headers: { authorization: 'Bearer qstk_prefix_secret' } }), { params: Promise.resolve({ appId: 'app-1' }) });
        const text = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/plain');
        expect(text).toContain('line one');
    });
});
