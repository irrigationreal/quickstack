import appService from "@/server/services/app.service";
import apiKeyService from "@/server/services/api-key.service";
import auditService from "@/server/services/audit.service";
import quickDeployBuildStrategyService from "@/server/services/quickdeploy-build-strategy.service";
import quickDeployUploadService from "@/server/services/quickdeploy-upload.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { BuildCreateRequestZodModel } from "@/shared/model/agent-build-strategy.model";
import { ServiceException } from "@/shared/model/service.exception.model";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to build this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function GET() {
    return NextResponse.json(quickDeployBuildStrategyService.getCapabilities());
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
        return forbidden('API key does not have build permission.');
    }

    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return forbidden();
    }
    try {
        assertSessionCanWriteApp(authenticated.session, app.id);
    } catch {
        return forbidden();
    }

    const parsed = BuildCreateRequestZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid build request.' }, { status: 400 });
    }

    try {
        if (parsed.data.kind === 'remote-builder') {
            throw new ServiceException('remote builder is not configured on this server.');
        }
        const buildResult = quickDeployUploadService.normalizeBuildResult({
            imageReference: parsed.data.imageReference,
            strategy: 'local-docker',
            sourceProvenance: parsed.data.sourceProvenance,
            cacheHit: false,
        });
        quickDeployBuildStrategyService.recordBuildResult(app.id, buildResult);
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_BUILD_REQUESTED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            metadata: { strategy: buildResult.strategy, imageReference: buildResult.imageReference },
        });
        return NextResponse.json({ status: 'success', buildResult });
    } catch (error) {
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
        }
        throw error;
    }
}
