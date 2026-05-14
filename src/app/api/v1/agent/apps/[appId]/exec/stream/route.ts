import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import podExecSessionService from "@/server/services/pod-exec-session.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const streamExecZodModel = z.object({
    command: z.array(z.string().min(1)).default(['/bin/sh']),
    tty: z.boolean().default(true),
});

function parseHeaderCommand(request: Request) {
    const encoded = request.headers.get('x-quickstack-exec-command');
    if (!encoded) return null;
    try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        return streamExecZodModel.safeParse(parsed);
    } catch {
        return { success: false } as const;
    }
}

function unauthorized(message = 'Missing or invalid API key.') {
    return NextResponse.json({ status: 'error', message }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to open a shell for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

async function authorize(request: Request, appId: string) {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getById(appId);
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) {
        return { response: forbidden('API key does not have app write permission.') };
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return { response: forbidden() };
    }
    try { assertSessionCanWriteApp(authenticated.session, app.id); } catch { return { response: forbidden() }; }
    return { authenticated, app };
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try { authorized = await authorize(request, appId); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (authorized.response) return authorized.response;
    const headerCommand = parseHeaderCommand(request);
    if (headerCommand) {
        if (!headerCommand.success) {
            return NextResponse.json({ status: 'error', message: 'Invalid exec stream payload.' }, { status: 400 });
        }
        const opened = await podExecSessionService.openStream({ appId: authorized.app.id, projectId: authorized.app.projectId, command: headerCommand.data.command, tty: headerCommand.data.tty, stdin: request.body });
        return new Response(opened.stream, {
            headers: {
                'content-type': 'application/octet-stream',
                'cache-control': 'no-store',
                'x-quickstack-exec-session-id': opened.session.sessionId,
                'x-quickstack-heartbeat-mode': 'client',
                'x-quickstack-fixed-timeout': 'false',
            },
        });
    }

    const parsed = streamExecZodModel.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid exec stream payload.' }, { status: 400 });
    }
    const session = await podExecSessionService.open({ appId: authorized.app.id, projectId: authorized.app.projectId, command: parsed.data.command, tty: parsed.data.tty });
    return NextResponse.json({ status: 'success', session, heartbeat: { mode: 'client', fixedTimeout: false } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
    const { appId } = await params;
    let authorized;
    try { authorized = await authorize(request, appId); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (authorized.response) return authorized.response;
    const sessionId = new URL(request.url).searchParams.get('sessionId');
    if (!sessionId) {
        return NextResponse.json({ status: 'error', message: 'sessionId is required.' }, { status: 400 });
    }
    const session = podExecSessionService.close(sessionId);
    return NextResponse.json({ status: 'success', closed: Boolean(session), session });
}
