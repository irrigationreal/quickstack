import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import dataAccess from "@/server/adapter/db.client";
import deploymentLogService from "@/server/services/deployment-logs.service";
import podService from "@/server/services/pod.service";
import k3s from "@/server/adapter/kubernetes-api.adapter";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to read logs for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    const { appId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) {
        return forbidden('API key does not have app read permission.');
    }

    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return forbidden();
    }

    const requestUrl = new URL(request.url);
    const source = requestUrl.searchParams.get('source') ?? 'container';
    const tailLines = Math.min(Math.max(Number(requestUrl.searchParams.get('tail') ?? 200), 1), 2000);
    const requestedDeploymentId = requestUrl.searchParams.get('deploymentId');
    const deploymentRecord = requestedDeploymentId
        ? await dataAccess.client.deploymentRecord.findFirst({ where: { deploymentId: requestedDeploymentId, appId: app.id } })
        : await dataAccess.client.deploymentRecord.findFirst({ where: { appId: app.id }, orderBy: { createdAt: 'desc' } });

    let logs: string;
    let pods: Awaited<ReturnType<typeof podService.getPodsForApp>> = [];
    if (source === 'deployment') {
        if (!deploymentRecord) {
            return NextResponse.json({ status: 'error', message: 'No deployment logs found for this app.' }, { status: 404 });
        }
        logs = await deploymentLogService.getLogsText(deploymentRecord.deploymentId).catch(error => {
            if (error instanceof Error) return error.message;
            return 'Unable to read deployment logs.';
        });
    } else {
        pods = await podService.getPodsForApp(app.projectId, app.id);
        const runningPod = pods.find(pod => pod.status === 'Running') ?? pods[0];
        if (!runningPod) {
            return NextResponse.json({ status: 'error', message: 'No app pods found for this app.' }, { status: 404 });
        }
        const response = await k3s.core.readNamespacedPodLog({
            name: runningPod.podName,
            namespace: app.projectId,
            container: runningPod.containerName,
            tailLines,
            timestamps: true,
        });
        logs = typeof response === 'string' ? response : response.body ?? '';
    }

    await auditService.recordBestEffort({
        ...authenticated.auditActor,
        action: 'AGENT_APP_LOGS_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: app.id,
        projectId: app.projectId,
        appId: app.id,
        appName: app.name,
        deploymentId: deploymentRecord?.deploymentId,
        metadata: { source, tailLines },
    });

    return NextResponse.json({
        status: 'success',
        appId: app.id,
        projectId: app.projectId,
        source,
        deploymentId: deploymentRecord?.deploymentId ?? null,
        deploymentStatus: deploymentRecord?.status ?? null,
        pods,
        logs,
    });
}
