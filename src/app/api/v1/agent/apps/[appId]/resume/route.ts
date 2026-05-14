import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import deploymentService from "@/server/services/deployment.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const resumeZodModel = z.object({
    replicas: z.number().int().min(1).max(100).optional(),
});

function unauthorized(message = 'Missing or invalid API key.') {
    return NextResponse.json({ status: 'error', message }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to resume this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch (error) {
        return unauthorized(error instanceof Error ? error.message : undefined);
    }

    const { appId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'deploy:write')) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_RESUME_REQUESTED',
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
        return forbidden();
    }
    try {
        assertSessionCanWriteApp(authenticated.session, app.id);
    } catch {
        return forbidden();
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = resumeZodModel.safeParse(rawBody ?? {});
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid resume payload.' }, { status: 400 });
    }

    const previousReplicas = app.replicas;
    const replicas = parsed.data.replicas ?? (app.replicas > 0 ? app.replicas : 1);
    const deployment = await deploymentService.setReplicasForDeployment(app.projectId, app.id, replicas);
    if (app.replicas !== replicas) {
        await appService.save({ id: app.id, replicas }, false);
    }

    await auditService.recordBestEffort({
        ...authenticated.auditActor,
        action: 'AGENT_APP_RESUME_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: app.id,
        projectId: app.projectId,
        appId: app.id,
        appName: app.name,
        metadata: { previousReplicas, replicas },
    });

    return NextResponse.json({
        status: 'success',
        appId: app.id,
        projectId: app.projectId,
        previousReplicas,
        replicas,
        readyReplicas: deployment.body?.status?.readyReplicas ?? null,
    });
}
