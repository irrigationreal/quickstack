import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import zlib from "zlib";
import dataAccess from "../adapter/db.client";
import auditService, { AuditActor } from "./audit.service";
import securityQuotaService from "./security-quota.service";
import { ServiceException } from "@/shared/model/service.exception.model";
import { QuickDeployUploadMetadataModel } from "@/shared/model/quickdeploy.model";
import registryService, { REGISTRY_URL_EXTERNAL, REGISTRY_URL_INTERNAL } from "./registry.service";
import { PathUtils } from "../utils/path.utils";

const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const TAR_BLOCK_SIZE = 512;
const UPLOAD_ROOT = path.join(PathUtils.internalDataRoot, "quickdeploy-uploads");
const DOCKER_MANIFEST_MEDIA_TYPE = 'application/vnd.docker.distribution.manifest.v2+json';
const DOCKER_CONFIG_MEDIA_TYPE = 'application/vnd.docker.container.image.v1+json';
const DOCKER_LAYER_MEDIA_TYPE = 'application/vnd.docker.image.rootfs.diff.tar.gzip';
const gzipAsync = promisify(zlib.gzip);

type TarEntry = {
    name: string;
    typeFlag: string;
    body: Buffer;
};

type DockerSaveManifest = {
    Config: string;
    RepoTags?: string[];
    Layers: string[];
}[];

function readTarString(block: Buffer, start: number, length: number) {
    return block.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim();
}

function isUnsafeArchivePath(value: string) {
    return value.startsWith('/') || value.split('/').some(segment => segment === '..');
}

function readTarEntries(body: Buffer): TarEntry[] {
    if (body.length % TAR_BLOCK_SIZE !== 0) {
        throw new ServiceException('QuickDeploy upload must be an uncompressed tar archive.');
    }

    const entries: TarEntry[] = [];
    for (let offset = 0; offset < body.length; offset += TAR_BLOCK_SIZE) {
        const block = body.subarray(offset, offset + TAR_BLOCK_SIZE);
        if (block.every(byte => byte === 0)) {
            return entries;
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

        const bodyStart = offset + TAR_BLOCK_SIZE;
        const bodyEnd = bodyStart + size;
        entries.push({ name, typeFlag, body: body.subarray(bodyStart, bodyEnd) });
        offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    }
    return entries;
}

function sha256Digest(body: Buffer) {
    return `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
}

function parseManagedImageReference(imageReference: string) {
    const slashIndex = imageReference.indexOf('/');
    const tagIndex = imageReference.lastIndexOf(':');
    if (slashIndex <= 0 || tagIndex <= slashIndex) {
        throw new ServiceException('QuickDeploy managed image reference is invalid.');
    }

    return {
        registryHost: imageReference.slice(0, slashIndex),
        repository: imageReference.slice(slashIndex + 1, tagIndex),
        tag: imageReference.slice(tagIndex + 1),
    };
}

function registryUrl(registryHost: string, location: string) {
    if (/^https?:\/\//.test(location)) {
        return location;
    }
    if (location.startsWith('/')) {
        return `http://${registryHost}${location}`;
    }
    return `http://${registryHost}/${location}`;
}

function toNodeRegistryImageReference(imageReference: string) {
    return imageReference.replace(`${REGISTRY_URL_INTERNAL}/`, `${REGISTRY_URL_EXTERNAL}/`);
}

async function assertRegistryResponse(response: Response, action: string) {
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ServiceException(`QuickDeploy registry ${action} failed with ${response.status}${body ? `: ${body}` : ''}`);
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

        const tarEntries = readTarEntries(input.body);
        const computedHash = sha256Digest(input.body);
        if (computedHash.toLowerCase() !== input.metadata.contentHash.toLowerCase()) {
            throw new ServiceException('QuickDeploy upload content hash does not match the request metadata.');
        }

        const build = await dataAccess.client.$transaction(async (tx) => {
            await securityQuotaService.reserveQuickDeployUploadQuota({
                actor: input.actor,
                projectId: input.app.projectId,
                uploadBytes: input.body.length,
                tx,
            });

            const created = await tx.quickDeployBuild.create({
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
            const imageReference = registryService.createManagedQuickDeployImageUrl(input.app.id, computedHash, created.id);
            return await tx.quickDeployBuild.update({
                where: { id: created.id },
                data: { imageReference },
            });
        });

        try {
            const saved = input.metadata.artifactType === 'docker-image-tar'
                ? await this.acceptDockerImageTar({ build, appId: input.app.id, body: input.body, tarEntries })
                : await this.acceptSourceTar({ build, body: input.body, tarEntries, metadata: input.metadata });

            await auditService.recordBestEffort({
                ...input.actor,
                action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
                outcome: 'SUCCESS',
                targetType: 'QUICKDEPLOY_BUILD',
                targetId: saved.id,
                projectId: input.app.projectId,
                appId: input.app.id,
                appName: input.app.name,
                metadata: {
                    mode: input.metadata.mode,
                    artifactType: input.metadata.artifactType,
                    contentHash: computedHash,
                    uploadBytes: input.body.length,
                    imageReference: saved.imageReference,
                },
            });
            return saved;
        } catch (error) {
            await dataAccess.client.quickDeployBuild.update({
                where: { id: build.id },
                data: { status: 'FAILED' },
            }).catch(() => undefined);
            throw error;
        }
    }

    async getLatestUploadedBuildForApp(appId: string) {
        const build = await dataAccess.client.quickDeployBuild.findFirst({
            where: {
                appId,
                status: { in: ['UPLOADED', 'BUILDING'] },
            },
            orderBy: { createdAt: 'desc' },
        });
        if (!build) {
            throw new ServiceException('No uploaded QuickDeploy source bundle is available for this app. Run quickstack launch/deploy from a local source directory first.');
        }
        return build;
    }

    async readStoredUpload(buildId: string, contentHash: string) {
        const build = await dataAccess.client.quickDeployBuild.findFirst({
            where: { id: buildId, contentHash },
        });
        if (!build) {
            throw new ServiceException('QuickDeploy source bundle not found.');
        }
        return fs.readFile(this.uploadPath(buildId));
    }

    private async acceptSourceTar(input: { build: { id: string }; body: Buffer; tarEntries: TarEntry[]; metadata: QuickDeployUploadMetadataModel }) {
        const files = new Set(input.tarEntries
            .filter(entry => entry.typeFlag === '0' || entry.typeFlag === '')
            .map(entry => entry.name.replace(/^\.\//, '')));
        if (input.metadata.mode === 'dockerfile') {
            const dockerfilePath = input.metadata.dockerfilePath.replace(/^\.\//, '');
            if (!files.has(dockerfilePath)) {
                throw new ServiceException(`QuickDeploy source upload is missing ${input.metadata.dockerfilePath}.`);
            }
        }
        await this.storeUpload(input.build.id, input.body);
        return dataAccess.client.quickDeployBuild.findFirstOrThrow({ where: { id: input.build.id } });
    }

    private async acceptDockerImageTar(input: {
        build: { id: string; imageReference: string | null };
        appId: string;
        body: Buffer;
        tarEntries: TarEntry[];
    }) {
        if (!input.build.imageReference) {
            throw new ServiceException('QuickDeploy managed image reference was not created.');
        }
        await this.pushDockerImageTarToRegistry(input.tarEntries, input.build.imageReference);
        const nodeImageReference = toNodeRegistryImageReference(input.build.imageReference);
        return dataAccess.client.$transaction(async (tx) => {
            await tx.app.update({
                where: { id: input.appId },
                data: {
                    sourceType: 'CONTAINER',
                    containerImageSource: nodeImageReference,
                    containerRegistryUsername: null,
                    containerRegistryPassword: null,
                },
            });
            return await tx.quickDeployBuild.update({
                where: { id: input.build.id },
                data: { status: 'SUCCEEDED', imageReference: nodeImageReference },
            });
        });
    }

    private async pushDockerImageTarToRegistry(entries: TarEntry[], imageReference: string) {
        const files = new Map(entries
            .filter(entry => entry.typeFlag === '0' || entry.typeFlag === '')
            .map(entry => [entry.name, entry.body]));
        const manifestJson = files.get('manifest.json');
        if (!manifestJson) {
            throw new ServiceException('QuickDeploy Docker image upload is missing manifest.json.');
        }

        const dockerManifest = JSON.parse(manifestJson.toString('utf8')) as DockerSaveManifest;
        const image = dockerManifest[0];
        if (!image?.Config || !image.Layers?.length) {
            throw new ServiceException('QuickDeploy Docker image upload has an invalid Docker save manifest.');
        }

        const config = files.get(image.Config);
        if (!config) {
            throw new ServiceException('QuickDeploy Docker image upload is missing image config.');
        }

        const { registryHost, repository, tag } = parseManagedImageReference(imageReference);
        const configDescriptor = await this.uploadRegistryBlob(registryHost, repository, config);
        const layers = [];
        for (const layerPath of image.Layers) {
            const layer = files.get(layerPath);
            if (!layer) {
                throw new ServiceException(`QuickDeploy Docker image upload is missing layer ${layerPath}.`);
            }
            layers.push(await this.uploadRegistryBlob(registryHost, repository, await gzipAsync(layer), DOCKER_LAYER_MEDIA_TYPE));
        }

        const manifest = {
            schemaVersion: 2,
            mediaType: DOCKER_MANIFEST_MEDIA_TYPE,
            config: {
                mediaType: DOCKER_CONFIG_MEDIA_TYPE,
                size: configDescriptor.size,
                digest: configDescriptor.digest,
            },
            layers,
        };

        const response = await fetch(registryUrl(registryHost, `/v2/${repository}/manifests/${tag}`), {
            method: 'PUT',
            headers: { 'content-type': DOCKER_MANIFEST_MEDIA_TYPE },
            body: JSON.stringify(manifest),
        });
        await assertRegistryResponse(response, 'manifest push');
    }

    private async uploadRegistryBlob(registryHost: string, repository: string, body: Buffer, mediaType = DOCKER_CONFIG_MEDIA_TYPE) {
        const digest = sha256Digest(body);
        const head = await fetch(registryUrl(registryHost, `/v2/${repository}/blobs/${digest}`), { method: 'HEAD' });
        if (head.ok) {
            return { mediaType, size: body.length, digest };
        }

        const started = await fetch(registryUrl(registryHost, `/v2/${repository}/blobs/uploads/`), { method: 'POST' });
        await assertRegistryResponse(started, 'blob upload start');
        const location = started.headers.get('location');
        if (!location) {
            throw new ServiceException('QuickDeploy registry blob upload did not return a location.');
        }

        const separator = location.includes('?') ? '&' : '?';
        const completed = await fetch(registryUrl(registryHost, `${location}${separator}digest=${encodeURIComponent(digest)}`), {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body,
        });
        await assertRegistryResponse(completed, 'blob upload complete');
        return { mediaType, size: body.length, digest };
    }

    private async storeUpload(buildId: string, body: Buffer) {
        await fs.mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
        await fs.writeFile(this.uploadPath(buildId), body, { mode: 0o600 });
    }

    private uploadPath(buildId: string) {
        return path.join(UPLOAD_ROOT, `${buildId}.tar`);
    }
}

const quickDeployUploadService = new QuickDeployUploadService();
export default quickDeployUploadService;
