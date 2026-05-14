import apiKeyService from "@/server/services/api-key.service";
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
        return { response: forbidden(scope === 'apps:read' ? 'API key user is not authorized to read this app.' : undefined) };
    }

    return { authenticated, app };
}

async function findJob(appId: string, jobId: string) {
    const jobs = await buildService.getBuildsForApp(appId);
    return jobs.find(job => job.name === jobId);
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string; jobId: string }> }) {
    const { appId, jobId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:read');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const job = await findJob(authorized.app.id, jobId);
    if (!job) return NextResponse.json({ status: 'error', message: 'Job not found.' }, { status: 404 });
    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, job });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ appId: string; jobId: string }> }) {
    const { appId, jobId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const job = await findJob(authorized.app.id, jobId);
    if (!job) return NextResponse.json({ status: 'error', message: 'Job not found.' }, { status: 404 });
    await buildService.deleteBuild(jobId);
    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_APP_JOB_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: authorized.app.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        message: 'Build job cancelled.',
        metadata: { jobId },
    });
    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, jobId, cancelled: true });
}
