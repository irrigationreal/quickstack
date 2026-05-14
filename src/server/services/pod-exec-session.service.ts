import { PassThrough, Readable } from "node:stream";
import type { WebSocket } from "ws";
import { Exec } from "@kubernetes/client-node";
import k3s from "../adapter/kubernetes-api.adapter";
import podService from "./pod.service";
import privateNetworkService from "./private-network.service";

export type PodExecSession = {
    sessionId: string;
    appId: string;
    projectId: string;
    podName: string;
    containerName: string;
    command: string[];
    tty: boolean;
    createdAt: string;
    lastHeartbeatAt: string;
};

const sessions = new Map<string, PodExecSession>();

class PodExecSessionService {
    async open(input: { appId: string; projectId: string; command: string[]; tty: boolean }) {
        const pods = await podService.getPodsForApp(input.projectId, input.appId);
        const pod = pods.find(item => item.status === 'Running') ?? pods[0];
        if (!pod) {
            throw new Error('No app pods found for this app.');
        }
        const transport = privateNetworkService.createExecSession({ appId: input.appId, projectId: input.projectId, podName: pod.podName, containerName: pod.containerName });
        const session: PodExecSession = {
            sessionId: transport.sessionId,
            appId: input.appId,
            projectId: input.projectId,
            podName: pod.podName,
            containerName: pod.containerName,
            command: input.command,
            tty: input.tty,
            createdAt: transport.createdAt,
            lastHeartbeatAt: transport.createdAt,
        };
        sessions.set(session.sessionId, session);
        return session;
    }

    async openWebSocket(input: { ws: WebSocket; appId: string; projectId: string; command: string[]; tty: boolean; stdinClosed?: boolean }) {
        const session = await this.open(input);
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const exec = new Exec(k3s.getKubeConfig());
        let lastPongAt = Date.now();
        let closed = false;
        let k8sSocket: WebSocket | undefined;
        const cleanup = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            stdin.end();
            stdout.end();
            k8sSocket?.close();
            this.close(session.sessionId);
        };
        const heartbeat = setInterval(() => {
            if (Date.now() - lastPongAt > 90_000) {
                input.ws.close(4000, 'Heartbeat timed out.');
                cleanup();
                return;
            }
            if (input.ws.readyState === input.ws.OPEN) input.ws.ping();
        }, 30_000);
        input.ws.on('pong', () => {
            lastPongAt = Date.now();
            this.heartbeat(session.sessionId);
        });
        input.ws.on('message', data => {
            this.heartbeat(session.sessionId);
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (chunk.length === 0) {
                stdin.end();
                return;
            }
            stdin.write(chunk);
        });
        input.ws.on('close', cleanup);
        input.ws.on('error', cleanup);
        stdout.on('data', chunk => {
            if (input.ws.readyState === input.ws.OPEN) input.ws.send(chunk);
        });
        stdout.on('close', () => {
            if (input.ws.readyState === input.ws.OPEN) input.ws.close(1000, 'Exec stream closed.');
        });

        k8sSocket = await exec.exec(
            session.projectId,
            session.podName,
            session.containerName,
            session.command,
            stdout,
            stdout,
            stdin,
            session.tty,
            (status: any) => {
                const exitCodeCause = status?.details?.causes?.find?.((cause: any) => cause.reason === 'ExitCode');
                const exitCode = Number.isInteger(Number(exitCodeCause?.message)) ? Number(exitCodeCause.message) : status?.status === 'Failure' ? 1 : 0;
                if (input.ws.readyState === input.ws.OPEN) input.ws.close(exitCode === 0 ? 1000 : 4001, `exitCode:${exitCode}`);
                cleanup();
            },
        );
        if (input.stdinClosed) stdin.end();
        return session;
    }

    async openStream(input: { appId: string; projectId: string; command: string[]; tty: boolean; stdin?: ReadableStream<Uint8Array> | null }) {
        const session = await this.open(input);
        const stdin = new PassThrough();
        const output = new PassThrough();
        const exec = new Exec(k3s.getKubeConfig());
        const closeSession = () => this.close(session.sessionId);

        if (input.stdin) {
            input.stdin.pipeTo(new WritableStream({
                write(chunk) {
                    stdin.write(Buffer.from(chunk));
                },
                close() {
                    stdin.end();
                },
                abort() {
                    stdin.destroy();
                },
            })).catch(() => stdin.destroy());
        } else {
            stdin.end();
        }

        const completion = exec.exec(
            session.projectId,
            session.podName,
            session.containerName,
            session.command,
            output,
            output,
            stdin,
            session.tty,
            () => {
                output.end();
                closeSession();
            },
        ).catch(error => {
            output.destroy(error);
            closeSession();
        });

        output.on('close', closeSession);
        output.on('error', closeSession);
        return { session, stream: Readable.toWeb(output) as ReadableStream<Uint8Array>, completion };
    }

    heartbeat(sessionId: string) {
        const session = sessions.get(sessionId);
        if (session) {
            session.lastHeartbeatAt = new Date().toISOString();
        }
        return session ?? null;
    }

    close(sessionId: string) {
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        return session ?? null;
    }

    list(appId: string) {
        return [...sessions.values()].filter(session => session.appId === appId);
    }
}

const podExecSessionService = new PodExecSessionService();
export default podExecSessionService;
