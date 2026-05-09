import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import quickDeployUploadService from "@/server/services/quickdeploy-upload.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { quickDeployUploadMetadataZodModel } from "@/shared/model/quickdeploy.model";
import { ServiceException } from "@/shared/model/service.exception.model";
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
    if (contentLength > quickDeployUploadService.getDefaultMaxUploadBytes()) {
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
            metadata: { uploadBytes: contentLength },
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
        const body = Buffer.from(await request.arrayBuffer());
        const build = await quickDeployUploadService.acceptUpload({
            app,
            metadata: parsed.data,
            body,
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
