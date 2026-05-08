const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));

const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const uploadMocks = vi.hoisted(() => ({
    getDefaultMaxUploadBytes: vi.fn(() => 1024),
    acceptUpload: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/services/quickdeploy-upload.service', () => ({ default: uploadMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));

import { POST } from './route';
import crypto from 'crypto';

function request(body: Buffer, metadata: Record<string, unknown>) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/upload-build', {
        method: 'POST',
        headers: {
            authorization: 'Bearer qstk_prefix_secret',
            'x-quickdeploy-metadata': JSON.stringify(metadata),
            'content-length': String(body.length),
        },
        body,
    });
}

function metadataFor(body: Buffer) {
    return {
        projectId: 'proj-1',
        mode: 'static',
        contentHash: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`,
    };
}

describe('agent QuickDeploy upload route', () => {
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
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Hello Static' });
        uploadMocks.getDefaultMaxUploadBytes.mockReturnValue(1024);
        uploadMocks.acceptUpload.mockResolvedValue({
            id: 'build-1',
            appId: 'app-1',
            projectId: 'proj-1',
            contentHash: 'sha256:abc',
            uploadBytes: 12,
            imageReference: 'registry-svc.registry-and-build.svc.cluster.local:5000/app-1:qd-abc-build-1',
            status: 'UPLOADED',
        });
    });

    it('requires build:write before reading upload bytes', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);
        const body = Buffer.from('hello');

        const response = await POST(request(body, metadataFor(body)), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(appMocks.getById).not.toHaveBeenCalled();
        expect(uploadMocks.acceptUpload).not.toHaveBeenCalled();
        expect(auditMocks.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({
            action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
            outcome: 'DENIED',
            message: 'API key does not have build:write scope.',
        }));
    });

    it('accepts a scoped upload and returns the managed image reference', async () => {
        const body = Buffer.from('hello');

        const response = await POST(request(body, metadataFor(body)), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(uploadMocks.acceptUpload).toHaveBeenCalledWith(expect.objectContaining({
            app: expect.objectContaining({ id: 'app-1', projectId: 'proj-1' }),
            metadata: expect.objectContaining({ projectId: 'proj-1', mode: 'static' }),
            body,
            actor: authenticated.auditActor,
        }));
        expect(json.imageReference).toBe('registry-svc.registry-and-build.svc.cluster.local:5000/app-1:qd-abc-build-1');
    });

    it('rejects oversized uploads before storing them', async () => {
        uploadMocks.getDefaultMaxUploadBytes.mockReturnValue(4);
        const body = Buffer.from('hello');

        const response = await POST(request(body, metadataFor(body)), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(413);
        expect(uploadMocks.acceptUpload).not.toHaveBeenCalled();
        expect(auditMocks.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({
            action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
            outcome: 'DENIED',
        }));
    });

    it('rejects app allowlist misses without storing upload bytes', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);
        const body = Buffer.from('hello');

        const response = await POST(request(body, metadataFor(body)), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(uploadMocks.acceptUpload).not.toHaveBeenCalled();
    });
});
