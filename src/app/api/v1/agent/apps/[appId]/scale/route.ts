import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import dataAccess from "@/server/adapter/db.client";
import deploymentService from "@/server/services/deployment.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const scaleZodModel = z.object({
    replicas: z.number().int().min(0).max(100),
});

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to scale this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
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
            action: 'AGENT_APP_SCALE_REQUESTED',
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

    const parsed = scaleZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid scale payload.' }, { status: 400 });
    }

    await dataAccess.client.app.update({
        where: { id: app.id },
        data: { replicas: parsed.data.replicas },
    });
    const deployment = await deploymentService.setReplicasForDeployment(app.projectId, app.id, parsed.data.replicas);

    await auditService.recordBestEffort({
        ...authenticated.auditActor,
        action: 'AGENT_APP_SCALE_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: app.id,
        projectId: app.projectId,
        appId: app.id,
        appName: app.name,
        metadata: { replicas: parsed.data.replicas },
    });

    return NextResponse.json({
        status: 'success',
        appId: app.id,
        projectId: app.projectId,
        replicas: parsed.data.replicas,
        readyReplicas: deployment.body?.status?.readyReplicas ?? null,
    });
}
