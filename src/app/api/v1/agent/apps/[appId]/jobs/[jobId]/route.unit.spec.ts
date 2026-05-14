const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));
const buildMocks = vi.hoisted(() => ({ getBuildsForApp: vi.fn(), deleteBuild: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);
vi.mock('@/server/services/build.service', () => ({ default: buildMocks }));

import { DELETE, GET } from './route';

function request(method = 'GET') {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/jobs/build-app-1', { method, headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app job detail route', () => {
    const authenticated = { session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', apiKeyId: 'key-1' } };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        buildMocks.getBuildsForApp.mockResolvedValue([{ name: 'build-app-1', status: 'RUNNING' }]);
    });

    it('shows a job owned by the app', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1', jobId: 'build-app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.job).toEqual({ name: 'build-app-1', status: 'RUNNING' });
    });

    it('cancels a job owned by the app', async () => {
        const response = await DELETE(request('DELETE'), { params: Promise.resolve({ appId: 'app-1', jobId: 'build-app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(buildMocks.deleteBuild).toHaveBeenCalledWith('build-app-1');
        expect(body.cancelled).toBe(true);
    });
});
