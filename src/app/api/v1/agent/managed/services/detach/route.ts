import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import serviceAttachmentService from "@/server/services/service-attachment.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
const payloadModel = z.object({ appId: z.string().min(1), serviceId: z.string().min(1), secretName: z.string().optional() });
function unauthorized(message = 'Missing or invalid API key.') { return NextResponse.json({ status: 'error', message }, { status: 401 }); }
function forbidden(message = 'API key is not authorized to detach this service.') { return NextResponse.json({ status: 'error', message }, { status: 403 }); }

export async function POST(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) return forbidden('API key does not have app write permission.');
    const parsed = payloadModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ status: 'error', message: 'Invalid service detach payload.' }, { status: 400 });
    const [app, service] = await Promise.all([appService.getById(parsed.data.appId), appService.getById(parsed.data.serviceId)]);
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app) || !apiKeyService.isAllowedForApp(authenticated.apiKey, service)) return forbidden();
    try {
        assertSessionCanWriteApp(authenticated.session, app.id);
        assertSessionCanWriteApp(authenticated.session, service.id);
    } catch { return forbidden(); }
    try {
        const detached = await serviceAttachmentService.detach({ ...parsed.data, actor: authenticated.auditActor });
        return NextResponse.json({ status: 'success', detached });
    } catch (error) {
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
        }
        throw error;
    }
}
