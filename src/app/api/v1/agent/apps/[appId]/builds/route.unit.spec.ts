const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));
const strategyMocks = vi.hoisted(() => ({ getCapabilities: vi.fn(), recordBuildResult: vi.fn() }));
const uploadMocks = vi.hoisted(() => ({ normalizeBuildResult: vi.fn(), findReusableBuildResult: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));
vi.mock('@/server/services/quickdeploy-build-strategy.service', () => ({ default: strategyMocks }));
vi.mock('@/server/services/quickdeploy-upload.service', () => ({ default: uploadMocks }));

import { GET, POST } from './route';

function request(body: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/builds', {
        method: 'POST',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: JSON.stringify(body),
    });
}

function getRequest(url = 'http://quickstack.test/api/v1/agent/apps/app-1/builds') {
    return new Request(url, { headers: { authorization: 'Bearer qstk_prefix_secret' } });
}

describe('agent app builds route', () => {
    const authenticated = { session: { id: 'user-1', email: 'admin@example.com' }, apiKey: { id: 'key-1', name: 'Agent' }, auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com' } };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        strategyMocks.getCapabilities.mockReturnValue({ strategies: ['source-tar', 'local-docker', 'existing-image'], remoteBuilder: false });
        uploadMocks.normalizeBuildResult.mockReturnValue({ image: { registry: 'registry.example', repository: 'app', tag: 'local' }, imageReference: 'registry.example/app:local', strategy: 'local-docker', sourceProvenance: 'local-docker', cacheHit: false });
        uploadMocks.findReusableBuildResult.mockResolvedValue(undefined);
    });

    it('returns build capabilities for an authorized app', async () => {
        const response = await GET(getRequest(), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.strategies).toContain('local-docker');
    });

    it('requires build scope before returning build capabilities', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await GET(getRequest(), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(strategyMocks.getCapabilities).not.toHaveBeenCalled();
    });

    it('returns cached source-tar build metadata for matching content hashes', async () => {
        const cached = { image: { registry: 'registry.example', repository: 'app', tag: 'cached' }, imageReference: 'registry.example/app:cached', strategy: 'source-tar', sourceProvenance: `sha256:${'a'.repeat(64)}`, cacheHit: true };
        uploadMocks.findReusableBuildResult.mockResolvedValue(cached);

        const response = await GET(getRequest(`http://quickstack.test/api/v1/agent/apps/app-1/builds?contentHash=sha256:${'a'.repeat(64)}`), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual({ status: 'hit', buildResult: cached });
        expect(uploadMocks.findReusableBuildResult).toHaveBeenCalledWith({ app: expect.objectContaining({ id: 'app-1' }), contentHash: `sha256:${'a'.repeat(64)}` });
    });

    it('finalizes a local Docker build into a normalized build result', async () => {
        const response = await POST(request({ kind: 'local-docker-finalize', imageReference: 'registry.example/app:local', sourceProvenance: 'local-docker' }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(uploadMocks.normalizeBuildResult).toHaveBeenCalledWith(expect.objectContaining({ imageReference: 'registry.example/app:local', strategy: 'local-docker' }));
        expect(strategyMocks.recordBuildResult).toHaveBeenCalledWith('app-1', body.buildResult);
    });

    it('returns a clear remote-builder not configured error', async () => {
        const response = await POST(request({ kind: 'remote-builder' }), { params: Promise.resolve({ appId: 'app-1' }) });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.message).toBe('remote builder is not configured on this server.');
    });
});
