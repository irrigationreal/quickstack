import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import monitorService from "@/server/services/monitoring.service";
import { assertSessionCanReadApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to read metrics for this app.') {
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
    try { assertSessionCanReadApp(authenticated.session, app.id); } catch { return forbidden('API key user is not authorized to read this app.'); }

    try {
        const resourceMetrics = await monitorService.getMonitoringForApp(app.projectId, app.id);
        const metrics = {
            resources: resourceMetrics,
            replicas: { desired: app.replicas ?? 0 },
            rollout: { state: 'unknown', message: 'Use quickstack status --watch for live rollout state.' },
        };
        return NextResponse.json({ status: 'success', appId: app.id, projectId: app.projectId, metrics });
    } catch (error) {
        return NextResponse.json({
            status: 'error',
            code: 'metrics_not_configured',
            message: 'App metrics are not configured or unavailable on this server.',
            detail: error instanceof Error ? error.message : String(error),
        }, { status: 503 });
    }
}
