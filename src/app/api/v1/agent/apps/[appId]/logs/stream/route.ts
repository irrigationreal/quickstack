import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import podService from "@/server/services/pod.service";
import k3s from "@/server/adapter/kubernetes-api.adapter";
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
    const pods = await podService.getPodsForApp(app.projectId, app.id);
    const pod = pods.find(item => item.status === 'Running') ?? pods[0];
    if (!pod) {
        return NextResponse.json({ status: 'error', message: 'No app pods found for this app.' }, { status: 404 });
    }
    const response = await k3s.core.readNamespacedPodLog({
        name: pod.podName,
        namespace: app.projectId,
        container: pod.containerName,
        follow: true,
        timestamps: true,
    } as any);
    const logs = typeof response === 'string' ? response : response.body ?? '';
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(logs || ': heartbeat\n\n'));
            controller.close();
        },
    });
    return new Response(stream, {
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}
