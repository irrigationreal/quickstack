import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import serviceAttachmentService from "@/server/services/service-attachment.service";
import { assertSessionCanReadApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized(message = 'Missing or invalid API key.') { return NextResponse.json({ status: 'error', message }, { status: 401 }); }
function forbidden(message = 'API key is not authorized to read services for this app.') { return NextResponse.json({ status: 'error', message }, { status: 403 }); }

export async function GET(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) return forbidden('API key does not have app read permission.');
    const appId = new URL(request.url).searchParams.get('appId');
    if (!appId) return NextResponse.json({ status: 'error', message: 'appId is required.' }, { status: 400 });
    const app = await appService.getById(appId);
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) return forbidden();
    try { assertSessionCanReadApp(authenticated.session, app.id); } catch { return forbidden('API key user is not authorized to read this app.'); }
    return NextResponse.json({ status: 'success', appId: app.id, projectId: app.projectId, services: await serviceAttachmentService.listForApp(app.id) });
}
