import apiKeyService from "@/server/services/api-key.service";
import dataAccess from "@/server/adapter/db.client";
import appService from "@/server/services/app.service";
import deploymentService from "@/server/services/deployment.service";
import podService from "@/server/services/pod.service";
import deploymentRecordService from "@/server/services/deployment-record.service";
import { assertSessionCanReadApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string; deploymentId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }
    const { appId, deploymentId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) {
        return NextResponse.json({ status: 'error', message: 'API key does not have app read permission.' }, { status: 403 });
    }
    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return NextResponse.json({ status: 'error', message: 'API key is not authorized to read this app.' }, { status: 403 });
    }
    try { assertSessionCanReadApp(authenticated.session, app.id); } catch { return NextResponse.json({ status: 'error', message: 'API key user is not authorized to read this app.' }, { status: 403 }); }
    const [deployment, pods] = await Promise.all([
        deploymentService.getDeployment(app.projectId, app.id).catch(() => null),
        podService.getPodsForApp(app.projectId, app.id).catch(() => []),
    ]);
    const status = deploymentRecordService.deploymentStatus(deploymentId, deployment, app.replicas ?? 1, pods);
    const recordStatus = status.rolloutState === 'healthy' ? 'SUCCESS' : (status.rolloutState === 'failed' || status.rolloutState === 'timed_out') ? 'FAILED' : undefined;
    if (recordStatus) {
        await dataAccess.client.deploymentRecord.updateMany({ where: { appId: app.id, deploymentId }, data: { status: recordStatus } }).catch(() => undefined);
    }
    return NextResponse.json(status);
}
