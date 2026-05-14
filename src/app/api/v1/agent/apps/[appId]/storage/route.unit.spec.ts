const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const storageMocks = vi.hoisted(() => ({ getForApp: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/storage-state.service', () => ({ default: storageMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { GET } from './route';

function request() {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/storage', { headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app storage route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        storageMocks.getForApp.mockResolvedValue({ volumes: [{ id: 'vol-1', mountPath: '/data', size: 1024 }], totalSize: 1024, snapshots: [] });
    });

    it('returns read-only storage state for an app', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(apiKeyMocks.hasScope).toHaveBeenCalledWith(expect.anything(), 'apps:read');
        expect(storageMocks.getForApp).toHaveBeenCalledWith('app-1');
        expect(body.storage.totalSize).toBe(1024);
        expect(body.volumes[0].mountPath).toBe('/data');
    });

    it('rejects keys without read scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(storageMocks.getForApp).not.toHaveBeenCalled();
    });
});
