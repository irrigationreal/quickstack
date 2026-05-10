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
vi.mock('@/server/utils/path.utils', () => ({ PathUtils: { internalDataRoot: '/tmp/quickstack-upload-route-test' } }));

import { POST } from './route';
import crypto from 'crypto';
import fs from 'fs/promises';

function request(body: Buffer, metadata: Record<string, unknown>, headers: Record<string, string> = {}) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/upload-build', {
        method: 'POST',
        headers: {
            authorization: 'Bearer qstk_prefix_secret',
            'x-quickdeploy-metadata': JSON.stringify(metadata),
            'content-length': String(body.length),
            ...headers,
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

    beforeEach(async () => {
        vi.clearAllMocks();
        await fs.rm('/tmp/quickstack-upload-route-test', { recursive: true, force: true });
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

    afterEach(async () => {
        await fs.rm('/tmp/quickstack-upload-route-test', { recursive: true, force: true });
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

    it('rejects chunked uploads whose declared total exceeds the upload limit', async () => {
        uploadMocks.getDefaultMaxUploadBytes.mockReturnValue(4);
        const body = Buffer.from('hello');

        const response = await POST(request(body, metadataFor(body), {
            'x-quickdeploy-upload-id': 'qd-test-upload-2',
            'x-quickdeploy-chunk-index': '0',
            'x-quickdeploy-chunk-count': '1',
            'x-quickdeploy-total-bytes': String(body.length),
        }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(413);
        expect(uploadMocks.acceptUpload).not.toHaveBeenCalled();
    });

    it('assembles chunked uploads before storing the build', async () => {
        uploadMocks.getDefaultMaxUploadBytes.mockReturnValue(1024 * 1024 * 1024);
        const body = Buffer.from('hello chunked world');
        const metadata = metadataFor(body);
        const first = body.subarray(0, 7);
        const second = body.subarray(7);
        const commonHeaders = {
            'x-quickdeploy-upload-id': 'qd-test-upload-1',
            'x-quickdeploy-chunk-count': '2',
            'x-quickdeploy-total-bytes': String(body.length),
        };

        const pending = await POST(request(first, metadata, {
            ...commonHeaders,
            'x-quickdeploy-chunk-index': '0',
        }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(pending.status).toBe(202);
        expect(uploadMocks.acceptUpload).not.toHaveBeenCalled();

        const complete = await POST(request(second, metadata, {
            ...commonHeaders,
            'x-quickdeploy-chunk-index': '1',
        }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(complete.status).toBe(200);
        expect(uploadMocks.acceptUpload).toHaveBeenCalledWith(expect.objectContaining({ body }));
    });

    it('rejects app allowlist misses without storing upload bytes', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);
        const body = Buffer.from('hello');

        const response = await POST(request(body, metadataFor(body)), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(uploadMocks.acceptUpload).not.toHaveBeenCalled();
    });
});
