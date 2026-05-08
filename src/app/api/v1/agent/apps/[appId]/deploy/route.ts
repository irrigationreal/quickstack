import appService from "@/server/services/app.service";
import apiKeyService from "@/server/services/api-key.service";
import auditService from "@/server/services/audit.service";
import buildWatchService from "@/server/services/standalone-services/build-watch.service";
import deploymentEventWatchService from "@/server/services/standalone-services/deployment-event-watch.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function GET() {
    return NextResponse.json({ status: 'error', message: 'Method not allowed.' }, { status: 405 });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    const { appId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'deploy:write')) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_DEPLOY_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: 'API key does not have deploy:write scope.',
        });
        return forbidden('API key does not have deploy permission.');
    }

    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_DEPLOY_REQUESTED',
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
            action: 'AGENT_DEPLOY_REQUESTED',
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

    buildWatchService.startWatch();
    deploymentEventWatchService.startWatch();

    const deployment = await appService.buildAndDeploy(app.id, true, authenticated.auditActor);

    return NextResponse.json({
        status: 'success',
        body: 'Deployment triggered.',
        deploymentId: deployment.deploymentId,
    });
}
