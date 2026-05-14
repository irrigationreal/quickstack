import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import { assertSessionCanReadApp, assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized(message = 'Missing or invalid API key.') {
    return NextResponse.json({ status: 'error', message }, { status: 401 });
}

function forbidden(message = 'API key is not authorized for this app.', details: Record<string, unknown> = {}) {
    return NextResponse.json({ status: 'error', message, ...details }, { status: 403 });
}

async function authenticate(request: Request, scope: 'apps:read' | 'apps:write') {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    if (!apiKeyService.hasScope(authenticated.apiKey, scope)) {
        return { authenticated, response: forbidden(scope === 'apps:read' ? 'API key does not have app read permission.' : 'API key does not have app write permission.') };
    }
    return { authenticated };
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let auth;
    try {
        auth = await authenticate(request, 'apps:read');
    } catch (error) {
        return unauthorized(error instanceof Error ? error.message : undefined);
    }
    if (auth.response) return auth.response;

    const { appId } = await params;
    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(auth.authenticated.apiKey, app)) {
        return forbidden(apiKeyService.appScopeDenialMessage(app), apiKeyService.appScopeDenial(auth.authenticated.apiKey, app));
    }
    try {
        assertSessionCanReadApp(auth.authenticated.session, app.id);
    } catch {
        return forbidden('API key user is not authorized to read this app.');
    }

    const summary = await appService.getApp(app.id);
    return NextResponse.json({ status: 'success', app: summary });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let auth;
    try {
        auth = await authenticate(request, 'apps:write');
    } catch (error) {
        return unauthorized(error instanceof Error ? error.message : undefined);
    }
    if (auth.response) return auth.response;

    const { appId } = await params;
    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'success', appId, deleted: false, message: 'App was already absent.' });
    }
    if (!apiKeyService.isAllowedForApp(auth.authenticated.apiKey, app)) {
        await auditService.recordBestEffort({
            ...auth.authenticated.auditActor,
            action: 'AGENT_APP_DESTROY_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: 'API key allowlist does not include this app.',
        });
        return forbidden(apiKeyService.appScopeDenialMessage(app), apiKeyService.appScopeDenial(auth.authenticated.apiKey, app));
    }
    try {
        assertSessionCanWriteApp(auth.authenticated.session, app.id);
    } catch {
        return forbidden('API key user is not authorized to destroy this app.');
    }

    const result = await appService.destroy(app.id, auth.authenticated.auditActor);
    return NextResponse.json({ status: 'success', ...result });
}
