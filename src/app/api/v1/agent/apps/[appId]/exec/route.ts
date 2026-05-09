import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import k3s from "@/server/adapter/kubernetes-api.adapter";
import podService from "@/server/services/pod.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { Exec } from "@kubernetes/client-node";
import { NextResponse } from "next/server";
import stream from "stream";
import { z } from "zod";

export const dynamic = "force-dynamic";

const execZodModel = z.object({
    command: z.array(z.string().min(1)).min(1).max(50),
    tty: z.boolean().default(false),
});

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to exec into this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

async function authenticateAndAuthorize(request: Request, appId: string) {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getById(appId);

    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_EXEC_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: 'API key does not have apps:write scope.',
        });
        return { response: forbidden('API key does not have app configuration permission.') };
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_EXEC_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: 'API key allowlist does not include this app.',
        });
        return { response: forbidden() };
    }

    try {
        assertSessionCanWriteApp(authenticated.session, app.id);
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_EXEC_REQUESTED',
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

    return { authenticated, app };
}

function collect(readable: stream.PassThrough) {
    const chunks: Buffer[] = [];
    readable.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    return () => Buffer.concat(chunks).toString('utf8');
}

function exitCodeFromStatus(status: unknown) {
    if (!status || typeof status !== 'object') return 0;
    const typed = status as { status?: string; details?: { causes?: Array<{ reason?: string; message?: string }> } };
    if (typed.status !== 'Failure') return 0;
    const exitCodeCause = typed.details?.causes?.find(cause => cause.reason === 'ExitCode');
    const parsed = Number(exitCodeCause?.message);
    return Number.isInteger(parsed) ? parsed : 1;
}

async function execInPod(input: { namespace: string; podName: string; containerName: string; command: string[]; tty: boolean }) {
    const stdoutStream = new stream.PassThrough();
    const stderrStream = new stream.PassThrough();
    const stdout = collect(stdoutStream);
    const stderr = collect(stderrStream);
    const exec = new Exec(k3s.getKubeConfig());

    const status = await new Promise<unknown>((resolve, reject) => {
        exec.exec(
            input.namespace,
            input.podName,
            input.containerName,
            input.command,
            stdoutStream,
            stderrStream,
            null,
            input.tty,
            resolve,
        ).catch(reject);
    });

    stdoutStream.end();
    stderrStream.end();
    return {
        stdout: stdout(),
        stderr: stderr(),
        exitCode: exitCodeFromStatus(status),
        status,
    };
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId);
    } catch {
        return unauthorized();
    }
    if ('response' in authorized) return authorized.response;

    const parsed = execZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid exec payload.' }, { status: 400 });
    }

    const pods = await podService.getPodsForApp(authorized.app.projectId, authorized.app.id);
    const runningPod = pods.find(pod => pod.status === 'Running') ?? pods[0];
    if (!runningPod) {
        return NextResponse.json({ status: 'error', message: 'No app pods found for this app.' }, { status: 404 });
    }

    const result = await execInPod({
        namespace: authorized.app.projectId,
        podName: runningPod.podName,
        containerName: runningPod.containerName,
        command: parsed.data.command,
        tty: parsed.data.tty,
    });

    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_APP_EXEC_REQUESTED',
        outcome: result.exitCode === 0 ? 'SUCCESS' : 'DENIED',
        targetType: 'APP',
        targetId: authorized.app.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        message: result.exitCode === 0 ? 'Exec completed.' : `Exec exited with code ${result.exitCode}.`,
        metadata: {
            command: parsed.data.command,
            podName: runningPod.podName,
            exitCode: result.exitCode,
        },
    });

    return NextResponse.json({
        status: result.exitCode === 0 ? 'success' : 'error',
        appId: authorized.app.id,
        projectId: authorized.app.projectId,
        podName: runningPod.podName,
        containerName: runningPod.containerName,
        command: parsed.data.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
    });
}
