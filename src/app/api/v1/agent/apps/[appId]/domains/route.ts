import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import agentDomainService from "@/server/services/agent-domain.service";
import { assertSessionCanReadApp, assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const domainPayload = z.object({
    hostname: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535).optional(),
    useSsl: z.boolean().optional(),
    redirectHttps: z.boolean().optional(),
});

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage domains for this app.', details: Record<string, unknown> = {}) {
    return NextResponse.json({ status: 'error', message, ...details }, { status: 403 });
}

async function authorize(request: Request, appId: string, scope: 'apps:read' | 'apps:write') {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getById(appId);
    if (!apiKeyService.hasScope(authenticated.apiKey, scope)) {
        return { response: forbidden(scope === 'apps:read' ? 'API key does not have app read permission.' : 'API key does not have app configuration permission.') };
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return { response: forbidden(apiKeyService.appScopeDenialMessage(app), apiKeyService.appScopeDenial(authenticated.apiKey, app)) };
    }
    try {
        if (scope === 'apps:write') assertSessionCanWriteApp(authenticated.session, app.id);
        else assertSessionCanReadApp(authenticated.session, app.id);
    } catch {
        return { response: forbidden(scope === 'apps:read' ? 'API key user is not authorized to read this app.' : undefined) };
    }
    return { authenticated, app };
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authorize(request, appId, 'apps:read');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const { app, domains } = await agentDomainService.list(appId);
    return NextResponse.json({ status: 'success', appId: app.id, projectId: app.projectId, domains });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const parsed = domainPayload.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid domain payload.' }, { status: 400 });
    }
    const domain = await agentDomainService.add(authorized.app.id, parsed.data);
    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_DOMAIN_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP_DOMAIN',
        targetId: domain.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        metadata: { hostname: domain.hostname },
    });
    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, domain });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const hostname = body.hostname ?? body.domain ?? url.searchParams.get('hostname') ?? url.searchParams.get('domain');
    if (!hostname) {
        return NextResponse.json({ status: 'error', message: 'hostname is required.' }, { status: 400 });
    }
    const removed = await agentDomainService.remove(authorized.app.id, hostname);
    if (!removed) {
        return NextResponse.json({ status: 'error', message: 'Domain not found.' }, { status: 404 });
    }
    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_DOMAIN_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP_DOMAIN',
        targetId: removed.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        message: 'Domain removed.',
        metadata: { hostname: removed.hostname },
    });
    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, removed });
}
