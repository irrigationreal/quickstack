const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const k3sMocks = vi.hoisted(() => ({ log: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/pod.service', () => ({ default: podMocks }));
vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({ default: { log: { log: k3sMocks.log } } }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { GET } from './route';

describe('agent logs stream route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        podMocks.getPodsForApp.mockResolvedValue([{ podName: 'pod-1', containerName: 'app', status: 'Running' }]);
        k3sMocks.log.mockImplementation((_namespace, _pod, _container, output) => {
            output.write('line one\n');
            return { abort: vi.fn() };
        });
    });

    it('sets up a continuous Kubernetes log stream and cancels it when the client disconnects', async () => {
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/apps/app-1/logs/stream?tail=25', { headers: { authorization: 'Bearer qstk_prefix_secret' } }), { params: Promise.resolve({ appId: 'app-1' }) });
        const reader = response.body!.getReader();
        const { value } = await reader.read();
        await reader.cancel();
        const text = new TextDecoder().decode(value);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/plain');
        expect(text).toContain('line one');
        expect(k3sMocks.log).toHaveBeenCalledWith('proj-1', 'pod-1', 'app', expect.anything(), expect.objectContaining({ follow: true, tailLines: 25 }));
    });
});
