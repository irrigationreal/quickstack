import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import publicEndpointService from "@/server/services/public-endpoint.service";
import { assertSessionCanReadApp, assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { parseSourceCidrsText, publicEndpointEditZodModel } from "@/shared/model/public-endpoint.model";
import { ServiceException } from "@/shared/model/service.exception.model";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const endpointReserveZodModel = publicEndpointEditZodModel.extend({
    id: z.string().min(1).optional(),
});

const endpointReleaseZodModel = z.object({
    id: z.string().min(1).optional(),
    publicIp: z.string().trim().optional(),
    publicPort: z.preprocess(value => typeof value === 'string' ? Number(value) : value, z.number().int().min(1).max(65535).optional()),
    protocol: z.enum(['TCP', 'UDP']).default('TCP'),
}).refine(value => Boolean(value.id) || Boolean(value.publicIp && value.publicPort), {
    message: 'Endpoint id or publicIp/publicPort/protocol is required.',
});

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage public endpoints for this app.', details: Record<string, unknown> = {}) {
    return NextResponse.json({ status: 'error', message, ...details }, { status: 403 });
}

function mapEndpoint(endpoint: any, app?: any) {
    const attachedDomain = app?.appDomains?.find((domain: any) => domain.port === endpoint.targetPort);
    return {
        id: endpoint.id,
        name: endpoint.name,
        appId: endpoint.appId,
        port: endpoint.targetPort,
        visibility: 'public',
        attachedDomainId: attachedDomain?.id,
        publicIp: endpoint.publicIp,
        publicPort: endpoint.publicPort,
        protocol: String(endpoint.protocol ?? 'TCP').toLowerCase(),
        targetPort: endpoint.targetPort,
        sourceCidrs: endpoint.sourceCidrsJson ? JSON.parse(endpoint.sourceCidrsJson) : [],
        proxyProtocol: endpoint.proxyProtocol,
        enabled: endpoint.enabled,
        status: endpoint.status,
        lastError: endpoint.lastError,
        createdAt: endpoint.createdAt,
        updatedAt: endpoint.updatedAt,
    };
}

async function authenticateAndAuthorize(request: Request, appId: string, scope: 'apps:read' | 'apps:write') {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getExtendedById(appId, false);

    if (!apiKeyService.hasScope(authenticated.apiKey, scope)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_PUBLIC_ENDPOINT_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: `API key does not have ${scope} scope.`,
        });
        return { response: forbidden(scope === 'apps:read' ? 'API key does not have app read permission.' : 'API key does not have app configuration permission.') };
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        const message = apiKeyService.appScopeDenialMessage(app);
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_PUBLIC_ENDPOINT_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message,
        });
        return { response: forbidden(message, apiKeyService.appScopeDenial(authenticated.apiKey, app)) };
    }

    if (scope === 'apps:read') {
        try { assertSessionCanReadApp(authenticated.session, app.id); } catch { return { response: forbidden('API key user is not authorized to read this app.') }; }
    }

    if (scope === 'apps:write') {
        try {
            assertSessionCanWriteApp(authenticated.session, app.id);
        } catch (error) {
            await auditService.recordBestEffort({
                ...authenticated.auditActor,
                action: 'AGENT_PUBLIC_ENDPOINT_REQUESTED',
                outcome: 'DENIED',
                targetType: 'APP',
                targetId: app.id,
                projectId: app.projectId,
                appId: app.id,
                appName: app.name,
                message: error instanceof Error ? error.message : 'API key user is not authorized for this app.',
            });
            return { response: forbidden() };
        }
    }

    return { authenticated, app };
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:read');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    return NextResponse.json({
        status: 'success',
        appId: authorized.app.id,
        projectId: authorized.app.projectId,
        endpoints: authorized.app.appPublicEndpoints.map(endpoint => mapEndpoint(endpoint, authorized.app)),
    });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const parsed = endpointReserveZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid public endpoint payload.' }, { status: 400 });
    }

    try {
        const endpoint = await publicEndpointService.saveAndReconcileForApp({
            id: parsed.data.id,
            appId: authorized.app.id,
            name: parsed.data.name?.trim() || null,
            publicIp: parsed.data.publicIp,
            publicPort: parsed.data.publicPort,
            targetPort: parsed.data.targetPort,
            protocol: parsed.data.protocol,
            sourceCidrsJson: JSON.stringify(parseSourceCidrsText(parsed.data.sourceCidrsText)),
            proxyProtocol: parsed.data.proxyProtocol,
            enabled: parsed.data.enabled,
            status: parsed.data.enabled ? 'PENDING' : 'DISABLED',
            lastError: null,
        });
        const saved = endpoint;

        await auditService.recordBestEffort({
            ...authorized.authenticated.auditActor,
            action: 'AGENT_PUBLIC_ENDPOINT_REQUESTED',
            outcome: 'SUCCESS',
            targetType: 'APP_PUBLIC_ENDPOINT',
            targetId: saved.id,
            projectId: authorized.app.projectId,
            appId: authorized.app.id,
            appName: authorized.app.name,
            metadata: {
                publicIp: saved.publicIp,
                publicPort: saved.publicPort,
                protocol: saved.protocol,
                targetPort: saved.targetPort,
            },
        });

        return NextResponse.json({
            status: 'success',
            appId: authorized.app.id,
            projectId: authorized.app.projectId,
            endpoint: mapEndpoint(endpoint, authorized.app),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Public endpoint reservation failed.';
        await auditService.recordBestEffort({
            ...authorized.authenticated.auditActor,
            action: 'AGENT_PUBLIC_ENDPOINT_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: authorized.app.id,
            projectId: authorized.app.projectId,
            appId: authorized.app.id,
            appName: authorized.app.name,
            message,
        });
        if (error instanceof ServiceException) {
            const status = message.includes('already reserved') || message.includes('reserved for') ? 409 : 400;
            return NextResponse.json({ status: 'error', message }, { status });
        }
        throw error;
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const parsed = endpointReleaseZodModel.safeParse(await request.json().catch(() => Object.fromEntries(new URL(request.url).searchParams.entries())));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid public endpoint release payload.' }, { status: 400 });
    }

    const endpoint = parsed.data.id
        ? authorized.app.appPublicEndpoints.find(item => item.id === parsed.data.id)
        : authorized.app.appPublicEndpoints.find(item => item.publicIp === parsed.data.publicIp && item.publicPort === parsed.data.publicPort && item.protocol === parsed.data.protocol);
    if (!endpoint) {
        return NextResponse.json({ status: 'error', message: 'Public endpoint reservation not found.' }, { status: 404 });
    }

    await publicEndpointService.deleteAndReconcileForApp(endpoint.id);
    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_PUBLIC_ENDPOINT_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP_PUBLIC_ENDPOINT',
        targetId: endpoint.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        message: 'Public endpoint reservation released.',
        metadata: {
            publicIp: endpoint.publicIp,
            publicPort: endpoint.publicPort,
            protocol: endpoint.protocol,
        },
    });

    return NextResponse.json({
        status: 'success',
        appId: authorized.app.id,
        projectId: authorized.app.projectId,
        released: mapEndpoint(endpoint, authorized.app),
    });
}
