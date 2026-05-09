const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({
    getExtendedById: vi.fn(),
    getVolumeById: vi.fn(),
    saveVolume: vi.fn(),
    deleteVolumeById: vi.fn(),
}));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));
const dataAccessMocks = vi.hoisted(() => ({ appVolumeCount: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));
vi.mock('@/server/adapter/db.client', () => ({
    default: {
        client: {
            appVolume: {
                count: dataAccessMocks.appVolumeCount,
            },
        },
    },
}));

import { DELETE, GET, POST } from './route';

function request(method: string, body?: Record<string, unknown>) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/volumes', {
        method,
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent app volumes route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
        auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' },
    };
    const volume = {
        id: 'vol-1',
        appId: 'app-1',
        containerMountPath: '/data',
        size: 1024,
        accessMode: 'ReadWriteOnce',
        storageClassName: 'longhorn',
        shareWithOtherApps: false,
        sharedVolumeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getExtendedById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo App', replicas: 1, appVolumes: [volume] });
        appMocks.getVolumeById.mockResolvedValue(volume);
        appMocks.saveVolume.mockResolvedValue(volume);
        dataAccessMocks.appVolumeCount.mockResolvedValue(0);
    });

    it('lists volume metadata without requiring write scope', async () => {
        const response = await GET(request('GET'), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(apiKeyMocks.hasScope).toHaveBeenCalledWith(authenticated.apiKey, 'apps:read');
        expect(json.volumes[0]).toEqual(expect.objectContaining({ id: 'vol-1', containerMountPath: '/data', storageClassName: 'longhorn' }));
    });

    it('adds a Longhorn-backed volume for an authorized app', async () => {
        appMocks.getExtendedById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo App', replicas: 1, appVolumes: [] });

        const response = await POST(request('POST', {
            containerMountPath: '/data',
            size: 1024,
            accessMode: 'ReadWriteOnce',
            storageClassName: 'longhorn',
        }), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.saveVolume).toHaveBeenCalledWith(expect.objectContaining({
            appId: 'app-1',
            containerMountPath: '/data',
            size: 1024,
            accessMode: 'ReadWriteOnce',
            storageClassName: 'longhorn',
        }));
        expect(json.volume.containerMountPath).toBe('/data');
    });

    it('removes a volume by mount path', async () => {
        const response = await DELETE(request('DELETE', { containerMountPath: '/data' }), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(appMocks.deleteVolumeById).toHaveBeenCalledWith('vol-1');
        expect(json.removed.containerMountPath).toBe('/data');
    });
});
