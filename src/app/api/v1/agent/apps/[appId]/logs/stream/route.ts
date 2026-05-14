import stream from "node:stream";
import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import podService from "@/server/services/pod.service";
import k3s from "@/server/adapter/kubernetes-api.adapter";
import { assertSessionCanReadApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
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
        return NextResponse.json({ status: 'error', message: 'API key does not have app read permission.' }, { status: 403 });
    }
    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return NextResponse.json({ status: 'error', message: 'API key is not authorized to read this app.' }, { status: 403 });
    }
    try { assertSessionCanReadApp(authenticated.session, app.id); } catch { return NextResponse.json({ status: 'error', message: 'API key user is not authorized to read this app.' }, { status: 403 }); }
    const pods = await podService.getPodsForApp(app.projectId, app.id);
    const pod = pods.find(item => item.status === 'Running') ?? pods[0];
    if (!pod) {
        return NextResponse.json({ status: 'error', message: 'No app pods found for this app.' }, { status: 404 });
    }
    const requestedTail = Number(new URL(request.url).searchParams.get('tail') ?? '100');
    const tailLines = Number.isInteger(requestedTail) && requestedTail > 0 ? Math.min(requestedTail, 5000) : 100;
    const encoder = new TextEncoder();
    let logStream: stream.PassThrough | undefined;
    let logRequest: any;
    let heartbeat: NodeJS.Timeout | undefined;
    let closedByClient = false;

    const body = new ReadableStream({
        start(controller) {
            const stopHeartbeat = () => {
                if (heartbeat) clearInterval(heartbeat);
                heartbeat = undefined;
            };
            const safeClose = () => {
                stopHeartbeat();
                try { controller.close(); } catch { /* already closed */ }
            };
            heartbeat = setInterval(() => {
                try { controller.enqueue(encoder.encode(': heartbeat\n')); } catch { /* client is gone */ }
            }, 15000);
            (async () => {
                try {
                    logStream = new stream.PassThrough();
                    logStream.on('data', chunk => controller.enqueue(encoder.encode(chunk.toString())));
                    logStream.on('error', error => {
                        stopHeartbeat();
                        controller.error(error);
                    });
                    logStream.on('end', () => {
                        if (!closedByClient) safeClose();
                    });
                    logRequest = await k3s.log.log(app.projectId, pod.podName, pod.containerName, logStream, {
                        follow: true,
                        tailLines,
                        timestamps: true,
                        pretty: false,
                        previous: false,
                    });
                    if (closedByClient) logRequest?.abort?.();
                } catch (error) {
                    stopHeartbeat();
                    controller.error(error);
                }
            })();
        },
        cancel() {
            closedByClient = true;
            if (heartbeat) clearInterval(heartbeat);
            logStream?.destroy();
            logRequest?.abort?.();
        },
    });
    return new Response(body, {
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            'content-encoding': 'none',
            connection: 'keep-alive',
        },
    });
}
