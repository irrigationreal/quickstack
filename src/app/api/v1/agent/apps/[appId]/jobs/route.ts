import apiKeyService from "@/server/services/api-key.service";
import crypto from "node:crypto";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import buildService from "@/server/services/build.service";
import { assertSessionCanReadApp, assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage jobs for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

async function authenticateAndAuthorize(request: Request, appId: string, scope: 'apps:read' | 'apps:write') {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getById(appId);

    if (!apiKeyService.hasScope(authenticated.apiKey, scope)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_JOB_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: `API key does not have ${scope} scope.`,
        });
        return { response: forbidden(scope === 'apps:read' ? 'API key does not have app read permission.' : 'API key does not have app write permission.') };
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return { response: forbidden() };
    }

    try {
        if (scope === 'apps:write') {
            assertSessionCanWriteApp(authenticated.session, app.id);
        } else {
            assertSessionCanReadApp(authenticated.session, app.id);
        }
    } catch {
        return { response: forbidden(scope === 'apps:write' ? undefined : 'API key user is not authorized to read this app.') };
    }

    return { authenticated, app };
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:read');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const jobs = await buildService.getBuildsForApp(authorized.app.id);
    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, jobs });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const body = await request.json().catch(() => ({}));
    if (body?.kind && body.kind !== 'build') {
        return NextResponse.json({ status: 'error', message: 'Only build jobs are supported by quickstack jobs run in this version.' }, { status: 400 });
    }
    const deploymentId = `agent-job-${crypto.randomUUID()}`;
    const extendedApp = await appService.getExtendedById(authorized.app.id, false);
    const [jobName, gitCommit, message, cacheHit] = await buildService.buildApp(deploymentId, extendedApp, Boolean(body?.force));
    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_APP_JOB_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: authorized.app.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        metadata: { kind: 'build', jobName, deploymentId, gitCommit, cacheHit },
    });
    return NextResponse.json({
        status: 'success',
        appId: authorized.app.id,
        projectId: authorized.app.projectId,
        job: { id: jobName, name: jobName, kind: 'build', deploymentId, gitCommit, message, cacheHit },
    });
}
