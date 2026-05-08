import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import dataAccess from "../adapter/db.client";
import auditService, { AuditActor } from "./audit.service";
import securityQuotaService from "./security-quota.service";
import { ServiceException } from "@/shared/model/service.exception.model";
import { QuickDeployUploadMetadataModel } from "@/shared/model/quickdeploy.model";
import registryService from "./registry.service";

const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const TAR_BLOCK_SIZE = 512;
const UPLOAD_ROOT = path.join(process.cwd(), ".quickdeploy-uploads");

function readTarString(block: Buffer, start: number, length: number) {
    return block.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim();
}

function isUnsafeArchivePath(value: string) {
    return value.startsWith('/') || value.split('/').some(segment => segment === '..');
}

function assertTarLooksSafe(body: Buffer) {
    if (body.length % TAR_BLOCK_SIZE !== 0) {
        throw new ServiceException('QuickDeploy upload must be an uncompressed tar archive.');
    }

    for (let offset = 0; offset < body.length; offset += TAR_BLOCK_SIZE) {
        const block = body.subarray(offset, offset + TAR_BLOCK_SIZE);
        if (block.every(byte => byte === 0)) {
            return;
        }
        const name = readTarString(block, 0, 100);
        const typeFlag = readTarString(block, 156, 1) || '0';
        const linkName = readTarString(block, 157, 100);

        if (!name || isUnsafeArchivePath(name) || (linkName && isUnsafeArchivePath(linkName))) {
            throw new ServiceException('QuickDeploy upload contains an unsafe tar path.');
        }
        if (typeFlag === '1' || typeFlag === '2') {
            throw new ServiceException('QuickDeploy upload cannot contain hardlinks or symlinks.');
        }

        const rawSize = readTarString(block, 124, 12).replace(/\0/g, '').trim();
        const size = rawSize ? Number.parseInt(rawSize, 8) : 0;
        if (!Number.isFinite(size) || size < 0) {
            throw new ServiceException('QuickDeploy upload contains an invalid tar entry size.');
        }
        offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    }
}

class QuickDeployUploadService {
    getDefaultMaxUploadBytes() {
        return DEFAULT_MAX_UPLOAD_BYTES;
    }

    async acceptUpload(input: {
        app: { id: string; projectId: string; name: string };
        metadata: QuickDeployUploadMetadataModel;
        body: Buffer;
        actor: AuditActor;
    }) {
        if (input.metadata.projectId !== input.app.projectId) {
            throw new ServiceException('App does not belong to the requested project.');
        }
        if (input.body.length === 0) {
            throw new ServiceException('QuickDeploy upload is empty.');
        }
        if (input.body.length > DEFAULT_MAX_UPLOAD_BYTES) {
            throw new ServiceException(`QuickDeploy upload can be at most ${DEFAULT_MAX_UPLOAD_BYTES} byte(s).`);
        }

        assertTarLooksSafe(input.body);

        const computedHash = `sha256:${crypto.createHash('sha256').update(input.body).digest('hex')}`;
        if (computedHash.toLowerCase() !== input.metadata.contentHash.toLowerCase()) {
            throw new ServiceException('QuickDeploy upload content hash does not match the request metadata.');
        }

        return dataAccess.client.$transaction(async (tx) => {
            await securityQuotaService.reserveQuickDeployUploadQuota({
                actor: input.actor,
                projectId: input.app.projectId,
                uploadBytes: input.body.length,
                tx,
            });

            const build = await tx.quickDeployBuild.create({
                data: {
                    appId: input.app.id,
                    projectId: input.app.projectId,
                    mode: input.metadata.mode,
                    contentHash: computedHash,
                    status: 'UPLOADED',
                    uploadBytes: input.body.length,
                    createdByApiKeyId: input.actor.apiKeyId ?? null,
                }
            });
            const imageReference = registryService.createManagedQuickDeployImageUrl(input.app.id, computedHash, build.id);
            const saved = await tx.quickDeployBuild.update({
                where: { id: build.id },
                data: { imageReference },
            });
            await this.storeUpload(saved.id, input.body);
            return saved;
        }).then(async (build) => {
            await auditService.recordBestEffort({
                ...input.actor,
                action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
                outcome: 'SUCCESS',
                targetType: 'QUICKDEPLOY_BUILD',
                targetId: build.id,
                projectId: input.app.projectId,
                appId: input.app.id,
                appName: input.app.name,
                metadata: {
                    mode: input.metadata.mode,
                    contentHash: computedHash,
                    uploadBytes: input.body.length,
                    imageReference: build.imageReference,
                },
            });
            return build;
        });
    }

    private async storeUpload(buildId: string, body: Buffer) {
        await fs.mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(UPLOAD_ROOT, `${buildId}.tar`), body, { mode: 0o600 });
    }
}

const quickDeployUploadService = new QuickDeployUploadService();
export default quickDeployUploadService;
