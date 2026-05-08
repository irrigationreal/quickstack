const dataAccessMocks = vi.hoisted(() => ({
    quickDeployBuildCreate: vi.fn(),
    quickDeployBuildUpdate: vi.fn(),
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
        }
    }
}));
vi.mock('./security-quota.service', () => ({ default: quotaMocks }));
vi.mock('./audit.service', () => ({ default: auditMocks }));
vi.mock('./registry.service', () => ({ default: registryMocks }));
vi.mock('fs/promises', () => ({ default: fsMocks, ...fsMocks }));

import crypto from 'crypto';
import quickDeployUploadService from './quickdeploy-upload.service';

function createTar(entries: Array<{ name: string; content?: string; typeFlag?: string; linkName?: string }>) {
    const blocks: Buffer[] = [];
    for (const entry of entries) {
        const content = Buffer.from(entry.content ?? '');
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

function metadataFor(body: Buffer) {
    return {
        projectId: 'proj-1',
        mode: 'static' as const,
        contentHash: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`,
        dockerfilePath: './Dockerfile',
    };
}

describe('quickdeploy-upload.service', () => {
    const actor = { actorType: 'API_KEY' as const, actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' };
    const app = { id: 'app-1', projectId: 'proj-1', name: 'Hello Static' };

    beforeEach(() => {
        vi.clearAllMocks();
        dataAccessMocks.transaction.mockImplementation(async (callback: any) => callback({
            quickDeployBuild: {
                create: dataAccessMocks.quickDeployBuildCreate,
                update: dataAccessMocks.quickDeployBuildUpdate,
            }
        }));
        dataAccessMocks.quickDeployBuildCreate.mockResolvedValue({ id: 'build-1' });
        dataAccessMocks.quickDeployBuildUpdate.mockResolvedValue({
            id: 'build-1',
            appId: 'app-1',
            projectId: 'proj-1',
            mode: 'static',
            contentHash: 'sha256:abc',
            uploadBytes: 5,
            imageReference: 'registry/app-1:qd-abc-build-1',
            status: 'UPLOADED',
        });
        registryMocks.createManagedQuickDeployImageUrl.mockReturnValue('registry/app-1:qd-abc-build-1');
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
        expect(result.imageReference).toBe('registry/app-1:qd-abc-build-1');
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
