const dataAccessMocks = vi.hoisted(() => ({
    quickDeployBuildCreate: vi.fn(),
    quickDeployBuildUpdate: vi.fn(),
    quickDeployBuildFindFirstOrThrow: vi.fn(),
    quickDeployBuildFindFirst: vi.fn(),
    appUpdate: vi.fn(),
    transaction: vi.fn(),
}));
const quotaMocks = vi.hoisted(() => ({ reserveQuickDeployUploadQuota: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const registryMocks = vi.hoisted(() => ({ createManagedQuickDeployImageUrl: vi.fn() }));
const fsMocks = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn() }));

vi.mock('../adapter/db.client', () => ({
    default: {
        client: {
            $transaction: dataAccessMocks.transaction,
            quickDeployBuild: {
                update: dataAccessMocks.quickDeployBuildUpdate,
                findFirst: dataAccessMocks.quickDeployBuildFindFirst,
                findFirstOrThrow: dataAccessMocks.quickDeployBuildFindFirstOrThrow,
            },
        }
    }
}));
vi.mock('./security-quota.service', () => ({ default: quotaMocks }));
vi.mock('./audit.service', () => ({ default: auditMocks }));
vi.mock('./registry.service', () => ({
    default: registryMocks,
    REGISTRY_URL_INTERNAL: 'registry-svc.registry-and-build.svc.cluster.local:5000',
    REGISTRY_URL_EXTERNAL: 'localhost:30100',
}));
vi.mock('fs/promises', () => ({ default: fsMocks, ...fsMocks }));

import crypto from 'crypto';
import quickDeployUploadService from './quickdeploy-upload.service';

function createTar(entries: Array<{ name: string; content?: string | Buffer; typeFlag?: string; linkName?: string }>) {
    const blocks: Buffer[] = [];
    for (const entry of entries) {
        const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content ?? '');
        const header = Buffer.alloc(512);
        header.write(entry.name, 0, 'utf8');
        header.write('0000644\0', 100, 'ascii');
        header.write('0000000\0', 108, 'ascii');
        header.write('0000000\0', 116, 'ascii');
        header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
        header.write('00000000000\0', 136, 'ascii');
        header.fill(' ', 148, 156);
        header.write(entry.typeFlag ?? '0', 156, 'ascii');
        if (entry.linkName) {
            header.write(entry.linkName, 157, 'utf8');
        }
        header.write('ustar\0', 257, 'ascii');
        header.write('00', 263, 'ascii');
        let checksum = 0;
        for (const byte of header) checksum += byte;
        header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
        blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
}

function metadataFor(body: Buffer, artifactType: 'source-tar' | 'docker-image-tar' = 'source-tar') {
    return {
        projectId: 'proj-1',
        mode: 'static' as const,
        artifactType,
        contentHash: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`,
        dockerfilePath: './Dockerfile',
        serviceRoot: '.',
    };
}

function createDockerImageTar() {
    const layer = createTar([{ name: 'index.html', content: 'hello' }]);
    const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', rootfs: { type: 'layers', diff_ids: [`sha256:${crypto.createHash('sha256').update(layer).digest('hex')}`] } }));
    const manifest = Buffer.from(JSON.stringify([{ Config: 'config.json', RepoTags: ['local/test:latest'], Layers: ['layer.tar'] }]));
    return createTar([
        { name: 'manifest.json', content: manifest.toString('utf8') },
        { name: 'config.json', content: config.toString('utf8') },
        { name: 'layer.tar', content: layer },
    ]);
}

describe('quickdeploy-upload.service', () => {
    const actor = { actorType: 'API_KEY' as const, actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' };
    const app = { id: 'app-1', projectId: 'proj-1', name: 'Hello Static' };

    beforeEach(() => {
        vi.clearAllMocks();
        dataAccessMocks.transaction.mockImplementation(async (callback: any) => callback({
            app: {
                update: dataAccessMocks.appUpdate,
            },
            quickDeployBuild: {
                create: dataAccessMocks.quickDeployBuildCreate,
                update: dataAccessMocks.quickDeployBuildUpdate,
            }
        }));
        dataAccessMocks.quickDeployBuildCreate.mockResolvedValue({ id: 'build-1' });
        const savedBuild = {
            id: 'build-1',
            appId: 'app-1',
            projectId: 'proj-1',
            mode: 'static',
            contentHash: 'sha256:abc',
            uploadBytes: 5,
            imageReference: 'registry.local:5000/app-1:qd-abc-build-1',
            status: 'UPLOADED',
        };
        dataAccessMocks.quickDeployBuildUpdate.mockImplementation(async (input: any) => ({
            ...savedBuild,
            ...(input.data ?? {}),
        }));
        dataAccessMocks.quickDeployBuildFindFirstOrThrow.mockResolvedValue(savedBuild);
        dataAccessMocks.quickDeployBuildFindFirst.mockResolvedValue(null);
        registryMocks.createManagedQuickDeployImageUrl.mockReturnValue('registry.local:5000/app-1:qd-abc-build-1');
        vi.stubGlobal('fetch', vi.fn());
    });

    it('stores the raw upload without extracting it and creates a managed image tag', async () => {
        const body = createTar([{ name: 'index.html', content: 'hello' }]);

        const result = await quickDeployUploadService.acceptUpload({ app, metadata: metadataFor(body), body, actor });

        expect(quotaMocks.reserveQuickDeployUploadQuota).toHaveBeenCalledWith(expect.objectContaining({
            actor,
            projectId: 'proj-1',
            uploadBytes: body.length,
        }));
        expect(dataAccessMocks.quickDeployBuildCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                appId: 'app-1',
                projectId: 'proj-1',
                mode: 'static',
                contentHash: metadataFor(body).contentHash,
                uploadBytes: body.length,
                createdByApiKeyId: 'key-1',
            })
        });
        expect(registryMocks.createManagedQuickDeployImageUrl).toHaveBeenCalledWith('app-1', metadataFor(body).contentHash, 'build-1');
        expect(fsMocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('build-1.tar'), body, { mode: 0o600 });
        expect(result.imageReference).toBe('registry.local:5000/app-1:qd-abc-build-1');
    });

    it('accepts Dockerfile source archives created by tar -C root -cf bundle .', async () => {
        const body = createTar([{ name: './Dockerfile', content: 'FROM node:22-alpine\n' }]);

        await expect(quickDeployUploadService.acceptUpload({
            app,
            metadata: { ...metadataFor(body), mode: 'dockerfile' },
            body,
            actor,
        })).resolves.toEqual(expect.objectContaining({ imageReference: 'registry.local:5000/app-1:qd-abc-build-1' }));

        expect(fsMocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('build-1.tar'), body, { mode: 0o600 });
    });

    it('pushes Docker image uploads into the internal registry and activates the managed image', async () => {
        const body = createDockerImageTar();
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
            const method = init?.method ?? 'GET';
            if (method === 'HEAD') {
                return new Response(null, { status: 404 });
            }
            if (method === 'POST') {
                return new Response(null, { status: 202, headers: { location: '/v2/app-1/blobs/uploads/upload-1' } });
            }
            if (method === 'PUT') {
                return new Response(null, { status: 201 });
            }
            return new Response(null, { status: 200 });
        });

        const result = await quickDeployUploadService.acceptUpload({ app, metadata: metadataFor(body, 'docker-image-tar'), body, actor });

        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v2/app-1/manifests/qd-abc-build-1'), expect.objectContaining({ method: 'PUT' }));
        expect(dataAccessMocks.appUpdate).toHaveBeenCalledWith({
            where: { id: 'app-1' },
            data: expect.objectContaining({
                sourceType: 'CONTAINER',
                containerImageSource: 'registry.local:5000/app-1:qd-abc-build-1',
            }),
        });
        expect(dataAccessMocks.quickDeployBuildUpdate).toHaveBeenCalledWith({
            where: { id: 'build-1' },
            data: expect.objectContaining({ status: 'SUCCEEDED' }),
        });
        expect(result.status).toBe('SUCCEEDED');
    });

    it('returns a reusable build result for a successful matching source tar', async () => {
        dataAccessMocks.quickDeployBuildFindFirst.mockResolvedValue({
            id: 'build-2',
            appId: 'app-1',
            projectId: 'proj-1',
            mode: 'static',
            contentHash: `sha256:${'a'.repeat(64)}`,
            uploadBytes: 512,
            imageReference: 'registry.local:5000/app-1:cached',
            status: 'SUCCEEDED',
        });

        const result = await quickDeployUploadService.findReusableBuildResult({ app, contentHash: `sha256:${'a'.repeat(64)}` });

        expect(dataAccessMocks.quickDeployBuildFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ appId: 'app-1', projectId: 'proj-1', status: 'SUCCEEDED' }),
        }));
        expect(result).toEqual(expect.objectContaining({
            imageReference: 'registry.local:5000/app-1:cached',
            strategy: 'source-tar',
            sourceProvenance: `sha256:${'a'.repeat(64)}`,
            cacheHit: true,
            buildId: 'build-2',
        }));
    });

    it('rejects a mismatched content hash before storing bytes', async () => {
        const body = createTar([{ name: 'index.html', content: 'hello' }]);
        await expect(quickDeployUploadService.acceptUpload({
            app,
            metadata: { ...metadataFor(body), contentHash: `sha256:${'0'.repeat(64)}` },
            body,
            actor,
        })).rejects.toThrow('content hash does not match');

        expect(dataAccessMocks.transaction).not.toHaveBeenCalled();
        expect(fsMocks.writeFile).not.toHaveBeenCalled();
    });

    it('rejects unsafe tar paths and links before storing bytes', async () => {
        const body = createTar([{ name: '../evil', content: 'owned' }]);

        await expect(quickDeployUploadService.acceptUpload({
            app,
            metadata: metadataFor(body),
            body,
            actor,
        })).rejects.toThrow('unsafe tar path');

        expect(dataAccessMocks.transaction).not.toHaveBeenCalled();
        expect(fsMocks.writeFile).not.toHaveBeenCalled();

        const symlinkBody = createTar([{ name: 'safe-link', typeFlag: '2', linkName: 'index.html' }]);
        await expect(quickDeployUploadService.acceptUpload({
            app,
            metadata: metadataFor(symlinkBody),
            body: symlinkBody,
            actor,
        })).rejects.toThrow('hardlinks or symlinks');
    });
});
