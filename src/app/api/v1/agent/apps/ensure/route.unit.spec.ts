const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));

const appMocks = vi.hoisted(() => ({
    getById: vi.fn(),
    save: vi.fn(),
    savePort: vi.fn(),
    getExtendedById: vi.fn(),
    saveDomain: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const domainMocks = vi.hoisted(() => ({ generateHostname: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/services/agent-domain.service', () => ({ default: domainMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));
vi.mock('@/shared/utils/role.utils', () => ({
    UserGroupUtils: {
        sessionCanCreateNewAppsForProject: vi.fn(() => true),
    },
}));

import { POST } from './route';

function request(body: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/apps/ensure', {
        method: 'POST',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: JSON.stringify(body),
    });
}

describe('agent ensure app route', () => {
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
        appMocks.getById.mockResolvedValue(null);
        appMocks.save.mockResolvedValue({ id: 'app-1', name: 'Hello Static', projectId: 'proj-1' });
        appMocks.getExtendedById.mockResolvedValue({ appDomains: [], appPorts: [] });
        domainMocks.generateHostname.mockResolvedValue('hello-static-abc123.irrigate.cc');
    });

    it('creates an uploaded-source app with port and generated domain', async () => {
        const response = await POST(request({
            projectId: 'proj-1',
            name: 'Hello Static',
            image: 'registry.example/hello-static:abc123',
            port: 80,
            domainPrefix: 'hello-static',
            mode: 'static',
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.save).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Hello Static',
            projectId: 'proj-1',
            sourceType: 'QUICKDEPLOY_UPLOAD',
            buildMethod: 'DOCKERFILE',
            dockerfilePath: './.quickstack/generated-static.Dockerfile',
            containerImageSource: 'registry.example/hello-static:abc123',
        }), true);
        expect(appMocks.savePort).toHaveBeenCalledWith({ appId: 'app-1', port: 80 });
        expect(appMocks.saveDomain).toHaveBeenCalledWith(expect.objectContaining({
            appId: 'app-1',
            hostname: 'hello-static-abc123.irrigate.cc',
            port: 80,
            useSsl: true,
            redirectHttps: true,
        }));
        expect(body.url).toBe('https://hello-static-abc123.irrigate.cc');
    });

    it('rejects deploy-only keys without apps:write', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await POST(request({ projectId: 'proj-1', name: 'Hello', image: 'image:tag' }));

        expect(response.status).toBe(403);
        expect(appMocks.save).not.toHaveBeenCalled();
    });

    it('rejects app/project allowlist misses', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);

        const response = await POST(request({ projectId: 'proj-1', name: 'Hello', image: 'image:tag' }));

        expect(response.status).toBe(403);
        expect(appMocks.save).not.toHaveBeenCalled();
    });

    it('updates an existing app instead of creating a duplicate', async () => {
        appMocks.getById.mockResolvedValue({
            id: 'app-1',
            name: 'Hello Static',
            projectId: 'proj-1',
            replicas: 1,
            ingressNetworkPolicy: 'ALLOW_ALL',
            egressNetworkPolicy: 'ALLOW_ALL',
            useNetworkPolicy: true,
        });
        appMocks.getExtendedById.mockResolvedValue({
            appDomains: [{ id: 'domain-1', hostname: 'hello-static-abc123.irrigate.cc' }],
            appPorts: [{ id: 'port-1', appId: 'app-1', port: 8080 }],
        });

        const response = await POST(request({
            projectId: 'proj-1',
            appId: 'app-1',
            name: 'Hello Static',
            image: 'registry.example/hello-static:def456',
            port: 8080,
            customHostname: 'hello-static-abc123.irrigate.cc',
        }));

        expect(response.status).toBe(200);
        expect(appMocks.save).toHaveBeenCalledWith(expect.objectContaining({
            id: 'app-1',
            containerImageSource: 'registry.example/hello-static:def456',
        }), false);
        expect(appMocks.savePort).not.toHaveBeenCalled();
        expect(appMocks.saveDomain).toHaveBeenCalledWith(expect.objectContaining({
            id: 'domain-1',
            hostname: 'hello-static-abc123.irrigate.cc',
            port: 8080,
            redirectHttps: false,
        }));
    });
});
