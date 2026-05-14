const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const strategyMocks = vi.hoisted(() => ({ getCapabilities: vi.fn(), recordBuildResult: vi.fn() }));
const uploadMocks = vi.hoisted(() => ({ findReusableBuildResult: vi.fn(), normalizeBuildResult: vi.fn() }));
const registryMocks = vi.hoisted(() => ({ getRegistryMetadataForApp: vi.fn() }));
const registryApiMocks = vi.hoisted(() => ({ getManifestWithDigest: vi.fn() }));
const authWrapperMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/services/quickdeploy-build-strategy.service', () => ({ default: strategyMocks }));
vi.mock('@/server/services/quickdeploy-upload.service', () => ({ default: uploadMocks }));
vi.mock('@/server/services/registry.service', () => ({ default: registryMocks }));
vi.mock('@/server/adapter/registry-api.adapter', () => ({ default: registryApiMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authWrapperMocks);

import { GET, POST } from './route';

const params = Promise.resolve({ appId: 'app-1' });

function request(body?: unknown) {
    return new Request('https://quickstack.example.com/api/v1/agent/apps/app-1/builds', {
        method: body ? 'POST' : 'GET',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent app builds route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo' });
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({
            session: { id: 'user-1', email: 'user@example.com' },
            apiKey: { id: 'key-1' },
            auditActor: { actorType: 'API_KEY', apiKeyId: 'key-1' },
        });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        strategyMocks.getCapabilities.mockReturnValue({ strategies: ['source-tar', 'local-docker', 'existing-image'], remoteBuilder: false });
        registryMocks.getRegistryMetadataForApp.mockResolvedValue({
            url: 'registry.quickstack.example.com',
            internalUrl: 'registry-svc.registry-and-build.svc.cluster.local:5000',
            repository: 'app-1',
            pushCredentials: true,
            auth: { type: 'token', realm: 'https://quickstack.example.com/api/v1/registry/token', service: 'quickstack-registry', issuer: 'quickstack-registry' },
        });
        registryApiMocks.getManifestWithDigest.mockResolvedValue(['sha256:abc123', { schemaVersion: 2 }]);
        uploadMocks.findReusableBuildResult.mockResolvedValue(undefined);
        uploadMocks.normalizeBuildResult.mockImplementation((input: any) => {
            const [registry, rest] = input.imageReference.split('/');
            const [repositoryWithMaybeDigest, tag] = rest.split(':');
            const [repository, digest] = repositoryWithMaybeDigest.split('@');
            return {
                image: { registry, repository, tag, digest },
                imageReference: input.imageReference,
                strategy: input.strategy,
                sourceProvenance: input.sourceProvenance,
                cacheHit: input.cacheHit,
            };
        });
    });

    it('returns app-scoped direct registry auth metadata in build capabilities', async () => {
        const response = await GET(request(), { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.registry).toEqual(expect.objectContaining({ url: 'registry.quickstack.example.com', repository: 'app-1', pushCredentials: true }));
    });

    it('requires build scope before returning build capabilities', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await GET(request(), { params });

        expect(response.status).toBe(403);
        expect(strategyMocks.getCapabilities).not.toHaveBeenCalled();
    });

    it('returns cached source-tar build metadata for matching content hashes', async () => {
        const cached = { image: { registry: 'registry.example', repository: 'app', tag: 'cached' }, imageReference: 'registry.example/app:cached', strategy: 'source-tar', sourceProvenance: `sha256:${'a'.repeat(64)}`, cacheHit: true };
        uploadMocks.findReusableBuildResult.mockResolvedValue(cached);

        const response = await GET(new Request(`http://quickstack.test/api/v1/agent/apps/app-1/builds?contentHash=sha256:${'a'.repeat(64)}`, { headers: { authorization: 'Bearer qstk_prefix_secret' } }), { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual({ status: 'hit', buildResult: cached });
        expect(uploadMocks.findReusableBuildResult).toHaveBeenCalledWith({ app: expect.objectContaining({ id: 'app-1' }), contentHash: `sha256:${'a'.repeat(64)}` });
    });

    it('finalizes local Docker builds only after verifying the manifest and pinning the internal digest', async () => {
        const response = await POST(request({ kind: 'local-docker-finalize', imageReference: 'registry.quickstack.example.com/app-1:quickstack-1', sourceProvenance: '/repo', buildSecrets: [] }), { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(registryApiMocks.getManifestWithDigest).toHaveBeenCalledWith('app-1', 'quickstack-1');
        expect(uploadMocks.normalizeBuildResult).toHaveBeenCalledWith(expect.objectContaining({
            imageReference: 'registry-svc.registry-and-build.svc.cluster.local:5000/app-1@sha256:abc123',
            strategy: 'local-docker',
        }));
        expect(strategyMocks.recordBuildResult).toHaveBeenCalledWith('app-1', expect.objectContaining({ imageReference: 'registry-svc.registry-and-build.svc.cluster.local:5000/app-1@sha256:abc123' }));
        expect(body.buildResult.imageReference).toContain('@sha256:abc123');
    });

    it('rejects finalizing an image pushed under another repository', async () => {
        const response = await POST(request({ kind: 'local-docker-finalize', imageReference: 'registry.quickstack.example.com/app-2:quickstack-1', sourceProvenance: '/repo', buildSecrets: [] }), { params });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.message).toContain('server-approved registry repository');
        expect(registryApiMocks.getManifestWithDigest).not.toHaveBeenCalled();
    });

    it('returns a clear remote-builder not configured error', async () => {
        const response = await POST(request({ kind: 'remote-builder' }), { params });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.message).toBe('remote builder is not configured on this server.');
    });
});
