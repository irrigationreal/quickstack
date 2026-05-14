import crypto from "crypto";

export type PrivateExecSession = {
    sessionId: string;
    appId: string;
    projectId: string;
    podName: string;
    containerName: string;
    createdAt: string;
};

export type PrivateNetworkSession = {
    sessionId: string;
    appId: string;
    projectId: string;
    localBind: string;
    remoteHost: string;
    remotePort: number;
    createdAt: string;
    expiresAt?: string;
};

class PrivateNetworkService {
    createExecSession(input: Omit<PrivateExecSession, 'sessionId' | 'createdAt'>): PrivateExecSession {
        return {
            sessionId: `exec-${crypto.randomUUID()}`,
            createdAt: new Date().toISOString(),
            ...input,
        };
    }

    createSession(input: Omit<PrivateNetworkSession, 'sessionId' | 'createdAt'>): PrivateNetworkSession {
        return {
            sessionId: `proxy-${crypto.randomUUID()}`,
            createdAt: new Date().toISOString(),
            ...input,
        };
    }
}

const privateNetworkService = new PrivateNetworkService();
export default privateNetworkService;
