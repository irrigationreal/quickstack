import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import proxySessionService from "@/server/services/proxy-session.service";
import { assertSessionCanReadApp, assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import net from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const proxyPayload = z.object({
    localBind: z.string().trim().min(1),
    remoteHost: z.string().trim().min(1),
    remotePort: z.number().int().min(1).max(65535),
    ttlSeconds: z.number().int().positive().optional(),
});

function unauthorized(message = 'Missing or invalid API key.') {
    return NextResponse.json({ status: 'error', message }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage proxy sessions for this app.', details: Record<string, unknown> = {}) {
    return NextResponse.json({ status: 'error', message, ...details }, { status: 403 });
}

async function authorize(request: Request, appId: string, scope: 'apps:read' | 'apps:write') {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getById(appId);
    if (!apiKeyService.hasScope(authenticated.apiKey, scope)) {
        return { response: forbidden(scope === 'apps:read' ? 'API key does not have app read permission.' : 'API key does not have app write permission.') };
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
    try { authorized = await authorize(request, appId, 'apps:read'); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (authorized.response) return authorized.response;
    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, sessions: proxySessionService.list(authorized.app.id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try { authorized = await authorize(request, appId, 'apps:write'); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (authorized.response) return authorized.response;

    const requestUrl = new URL(request.url);
    if (requestUrl.searchParams.get('connect') === '1') {
        const sessionId = requestUrl.searchParams.get('sessionId');
        if (!sessionId) return NextResponse.json({ status: 'error', message: 'sessionId is required.' }, { status: 400 });
        const session = proxySessionService.get(authorized.app.id, sessionId);
        if (!session) return NextResponse.json({ status: 'error', message: 'Proxy session not found.' }, { status: 404 });
        const socket = net.connect(session.remotePort, session.remoteHost);
        request.signal.addEventListener('abort', () => socket.destroy());
        request.body?.pipeTo(new WritableStream({
            write(chunk) {
                socket.write(Buffer.from(chunk));
            },
            close() {
                socket.end();
            },
            abort() {
                socket.destroy();
            },
        })).catch(() => socket.destroy());
        const stream = new ReadableStream({
            start(controller) {
                socket.on('data', chunk => controller.enqueue(chunk));
                socket.on('end', () => controller.close());
                socket.on('error', error => controller.error(error));
            },
            cancel() {
                socket.destroy();
            },
        });
        return new Response(stream, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
    }

    const parsed = proxyPayload.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid proxy payload.' }, { status: 400 });
    }
    try {
        const session = await proxySessionService.open(authorized.app.id, parsed.data);
        return NextResponse.json({ status: 'success', session });
    } catch (error) {
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
        }
        throw error;
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try { authorized = await authorize(request, appId, 'apps:write'); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (authorized.response) return authorized.response;
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const sessionId = body.sessionId ?? url.searchParams.get('sessionId');
    if (!sessionId) {
        return NextResponse.json({ status: 'error', message: 'sessionId is required.' }, { status: 400 });
    }
    const session = proxySessionService.close(authorized.app.id, sessionId);
    return NextResponse.json({ status: 'success', closed: Boolean(session), session });
}
