import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import deploymentService from "@/server/services/deployment.service";
import auditService from "@/server/services/audit.service";
import dataAccess from "@/server/adapter/db.client";
import podService from "@/server/services/pod.service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to read this app.') {
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

    const app = await appService.getExtendedById(appId, false).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_STATUS_REQUESTED',
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

    const [deployment, pods, deploymentRecords, quickDeployBuilds] = await Promise.all([
        deploymentService.getDeployment(app.projectId, app.id).catch(() => undefined),
        podService.getPodsForApp(app.projectId, app.id).catch(() => []),
        dataAccess.client.deploymentRecord.findMany({
            where: { appId: app.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
        }),
        dataAccess.client.quickDeployBuild.findMany({
            where: { appId: app.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
        }).catch(() => []),
    ]);
    const desiredReplicas = app.replicas ?? 0;
    const readyReplicas = deployment?.status?.readyReplicas ?? 0;
    const runningPods = pods.filter(pod => pod.status === 'Running').length;
    const health = !deployment
        ? 'missing'
        : desiredReplicas > 0 && readyReplicas >= desiredReplicas
            ? 'healthy'
            : readyReplicas > 0 || runningPods > 0
                ? 'degraded'
                : 'unhealthy';

    await auditService.recordBestEffort({
        ...authenticated.auditActor,
        action: 'AGENT_APP_STATUS_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: app.id,
        projectId: app.projectId,
        appId: app.id,
        appName: app.name,
    });

    return NextResponse.json({
        status: 'success',
        app: {
            id: app.id,
            name: app.name,
            projectId: app.projectId,
            sourceType: app.sourceType,
            buildMethod: app.buildMethod,
            replicas: app.replicas,
            image: app.containerImageSource,
            ports: app.appPorts.map(port => ({ id: port.id, port: port.port })),
            domains: app.appDomains.map(domain => ({ id: domain.id, hostname: domain.hostname, port: domain.port, url: `https://${domain.hostname}` })),
        },
        health,
        replicas: {
            desired: desiredReplicas,
            current: deployment?.status?.replicas ?? 0,
            ready: readyReplicas,
            updated: deployment?.status?.updatedReplicas ?? 0,
            unavailable: deployment?.status?.unavailableReplicas ?? 0,
        },
        pods,
        deployment: deployment ? {
            name: deployment.metadata?.name,
            namespace: deployment.metadata?.namespace,
            observedGeneration: deployment.status?.observedGeneration,
            replicas: deployment.status?.replicas ?? 0,
            readyReplicas,
            updatedReplicas: deployment.status?.updatedReplicas ?? 0,
            unavailableReplicas: deployment.status?.unavailableReplicas ?? 0,
            conditions: deployment.status?.conditions ?? [],
        } : null,
        latestDeployment: deploymentRecords[0] ?? null,
        releases: deploymentRecords,
        quickDeployBuilds: quickDeployBuilds.map(build => ({
            id: build.id,
            mode: build.mode,
            contentHash: build.contentHash,
            imageReference: build.imageReference,
            status: build.status,
            uploadBytes: build.uploadBytes,
            createdAt: build.createdAt,
            updatedAt: build.updatedAt,
        })),
    });
}
