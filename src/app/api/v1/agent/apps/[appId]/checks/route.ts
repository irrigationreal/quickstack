import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import deploymentService from "@/server/services/deployment.service";
import podService from "@/server/services/pod.service";
import auditService from "@/server/services/audit.service";
import { assertSessionCanReadApp, assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const checksPatchZodModel = z.object({
    path: z.string().trim().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    threshold: z.number().int().min(1).max(30).optional(),
    timeoutSeconds: z.number().int().min(1).max(60).optional(),
    periodSeconds: z.number().int().min(1).max(300).optional(),
}).refine(value => Boolean(value.path || value.port || value.threshold || value.timeoutSeconds || value.periodSeconds), { message: 'At least one health check field is required.' });

function unauthorized(message = 'Missing or invalid API key.') {
    return NextResponse.json({ status: 'error', message }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to read health checks for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch (error) {
        return unauthorized(error instanceof Error ? error.message : undefined);
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
    try {
        assertSessionCanReadApp(authenticated.session, app.id);
    } catch {
        return forbidden('API key user is not authorized to read this app.');
    }

    const [deployment, pods] = await Promise.all([
        deploymentService.getDeployment(app.projectId, app.id).catch(() => undefined),
        podService.getPodsForApp(app.projectId, app.id).catch(() => []),
    ]);
    const container = deployment?.spec?.template?.spec?.containers?.[0];
    const probes = {
        startup: container?.startupProbe ?? null,
        readiness: container?.readinessProbe ?? null,
        liveness: container?.livenessProbe ?? null,
    };

    return NextResponse.json({
        status: 'success',
        appId: app.id,
        projectId: app.projectId,
        checks: probes,
        pods: pods.map(pod => ({
            podName: pod.podName,
            status: pod.status ?? 'unknown',
            passing: pod.status === 'Running' || pod.status === 'Succeeded',
        })),
    });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch (error) {
        return unauthorized(error instanceof Error ? error.message : undefined);
    }

    const { appId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) {
        return forbidden('API key does not have app write permission.');
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
    const parsed = checksPatchZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid health check payload.' }, { status: 400 });
    }
    const saved = await appService.save({
        id: app.id,
        ...(parsed.data.path ? { healthChechHttpGetPath: parsed.data.path } : {}),
        ...(parsed.data.port ? { healthCheckHttpPort: parsed.data.port } : {}),
        ...(parsed.data.threshold ? { healthCheckFailureThreshold: parsed.data.threshold } : {}),
        ...(parsed.data.timeoutSeconds ? { healthCheckTimeoutSeconds: parsed.data.timeoutSeconds } : {}),
        ...(parsed.data.periodSeconds ? { healthCheckPeriodSeconds: parsed.data.periodSeconds } : {}),
    }, false);
    const restart = await appService.restart(app.id, authenticated.auditActor);
    await auditService.recordBestEffort({
        ...authenticated.auditActor,
        action: 'AGENT_APP_CHECKS_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: app.id,
        projectId: app.projectId,
        appId: app.id,
        appName: app.name,
        metadata: parsed.data,
    });
    return NextResponse.json({ status: 'success', appId: app.id, projectId: app.projectId, deploymentId: restart.deploymentId, checks: {
        path: saved.healthChechHttpGetPath,
        port: saved.healthCheckHttpPort,
        threshold: saved.healthCheckFailureThreshold,
        timeoutSeconds: saved.healthCheckTimeoutSeconds,
        periodSeconds: saved.healthCheckPeriodSeconds,
    } });
}
