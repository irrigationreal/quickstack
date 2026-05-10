import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import quickDeployUploadService from "@/server/services/quickdeploy-upload.service";
import { PathUtils } from "@/server/utils/path.utils";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { quickDeployUploadMetadataZodModel } from "@/shared/model/quickdeploy.model";
import { ServiceException } from "@/shared/model/service.exception.model";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to upload builds for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

function badRequest(message: string, status = 400) {
    return NextResponse.json({ status: 'error', message }, { status });
}

const CHUNK_ROOT = path.join(PathUtils.internalDataRoot, 'quickdeploy-upload-chunks');
const CHUNK_UPLOAD_ID_REGEX = /^[A-Za-z0-9._-]{8,120}$/;

function numberHeader(request: Request, name: string) {
    const value = request.headers.get(name);
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
}

async function readChunkedUpload(request: Request, metadata: unknown) {
    const uploadId = request.headers.get('x-quickdeploy-upload-id');
    if (!uploadId) {
        return { complete: true as const, body: Buffer.from(await request.arrayBuffer()) };
    }
    if (!CHUNK_UPLOAD_ID_REGEX.test(uploadId)) {
        throw new ServiceException('QuickDeploy chunk upload id is invalid.');
    }
    const chunkIndex = numberHeader(request, 'x-quickdeploy-chunk-index');
    const chunkCount = numberHeader(request, 'x-quickdeploy-chunk-count');
    const totalBytes = numberHeader(request, 'x-quickdeploy-total-bytes');
    if (chunkIndex === undefined || chunkCount === undefined || totalBytes === undefined || chunkIndex < 0 || chunkCount < 1 || chunkIndex >= chunkCount) {
        throw new ServiceException('QuickDeploy chunk headers are invalid.');
    }
    if (totalBytes > quickDeployUploadService.getDefaultMaxUploadBytes()) {
        throw new ServiceException('QuickDeploy upload is too large.');
    }

    const uploadDir = path.join(CHUNK_ROOT, uploadId);
    await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(uploadDir, 'metadata.json'), JSON.stringify(metadata), { mode: 0o600 });
    await fs.writeFile(path.join(uploadDir, `${chunkIndex}.part`), Buffer.from(await request.arrayBuffer()), { mode: 0o600 });

    const chunks: Buffer[] = [];
    for (let index = 0; index < chunkCount; index += 1) {
        try {
            chunks.push(await fs.readFile(path.join(uploadDir, `${index}.part`)));
        } catch {
            return {
                complete: false as const,
                uploadId,
                receivedChunks: index,
                chunkCount,
            };
        }
    }

    const body = Buffer.concat(chunks);
    if (body.length !== totalBytes) {
        await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
        throw new ServiceException('QuickDeploy chunked upload byte count does not match metadata.');
    }
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
    return { complete: true as const, body };
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    const { appId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'build:write')) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: 'API key does not have build:write scope.',
        });
        return forbidden('API key does not have managed build upload permission.');
    }

    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: 'API key allowlist does not include this app.',
        });
        return forbidden();
    }

    try {
        assertSessionCanWriteApp(authenticated.session, app.id);
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: error instanceof Error ? error.message : 'API key user is not authorized for this app.',
        });
        return forbidden();
    }

    const contentLengthHeader = request.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return badRequest('QuickDeploy upload requires a valid content-length header.', 411);
    }
    const totalUploadBytes = numberHeader(request, 'x-quickdeploy-total-bytes') ?? contentLength;
    if (totalUploadBytes > quickDeployUploadService.getDefaultMaxUploadBytes()) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: 'QuickDeploy upload exceeds the default maximum size.',
            metadata: { uploadBytes: totalUploadBytes },
        });
        return badRequest('QuickDeploy upload is too large.', 413);
    }

    const metadataHeader = request.headers.get('x-quickdeploy-metadata');
    if (!metadataHeader) {
        return badRequest('Missing QuickDeploy metadata.');
    }

    let parsed;
    try {
        parsed = quickDeployUploadMetadataZodModel.safeParse(JSON.parse(metadataHeader));
    } catch {
        return badRequest('Invalid QuickDeploy upload metadata.');
    }
    if (!parsed.success) {
        return badRequest('Invalid QuickDeploy upload metadata.');
    }

    try {
        const upload = await readChunkedUpload(request, parsed.data);
        if (!upload.complete) {
            return NextResponse.json({
                status: 'uploading',
                uploadId: upload.uploadId,
                receivedChunks: upload.receivedChunks,
                chunkCount: upload.chunkCount,
            }, { status: 202 });
        }
        const build = await quickDeployUploadService.acceptUpload({
            app,
            metadata: parsed.data,
            body: upload.body,
            actor: authenticated.auditActor,
        });
        return NextResponse.json({
            status: 'success',
            buildId: build.id,
            appId: build.appId,
            projectId: build.projectId,
            contentHash: build.contentHash,
            uploadBytes: build.uploadBytes,
            imageReference: build.imageReference,
            buildStatus: build.status,
        });
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_QUICKDEPLOY_UPLOAD_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: error instanceof Error ? error.message : 'QuickDeploy upload failed.',
        });
        if (error instanceof ServiceException) {
            return badRequest(error.message);
        }
        throw error;
    }
}
