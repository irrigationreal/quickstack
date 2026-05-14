import { AppTemplateUtils } from "../utils/app-template.utils";
import { KubeObjectNameUtils } from "../utils/kube-object-name.utils";
import dataAccess from "../adapter/db.client";
import appService from "./app.service";
import privateNetworkService, { PrivateNetworkSession } from "./private-network.service";
import { ServiceException } from "@/shared/model/service.exception.model";
import { managedAppTypes } from "./managed-service.utils";

const sessions = new Map<string, PrivateNetworkSession>();

function normalizeHost(host: string) {
    return host.trim().replace(/\.$/, '').toLowerCase();
}

function allowedPorts(app: { appPorts?: Array<{ port?: number | null }> }) {
    return new Set((app.appPorts ?? []).map(port => port.port).filter((port): port is number => Number.isInteger(port)));
}

class ProxySessionService {
    private async assertAllowedTarget(appId: string, input: { remoteHost: string; remotePort: number }) {
        const app = await appService.getExtendedById(appId, false);
        const remoteHost = normalizeHost(input.remoteHost);
        const appServiceHost = normalizeHost(KubeObjectNameUtils.toServiceName(app.id));
        if (remoteHost === appServiceHost && allowedPorts(app).has(input.remotePort)) {
            return app;
        }

        const managedRows = await dataAccess.client.app.findMany({
            where: { projectId: app.projectId, appType: { in: [...managedAppTypes] } },
            select: { id: true },
        });
        const managedApps = await Promise.all(managedRows.map(row => appService.getExtendedById(row.id, false).catch(() => null)));
        for (const managedApp of managedApps) {
            if (!managedApp) continue;
            const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(managedApp);
            if (normalizeHost(databaseInfo.hostname) === remoteHost && databaseInfo.port === input.remotePort) {
                return app;
            }
        }

        throw new ServiceException('Proxy target must be an app service port or managed service in the same project.');
    }

    async open(appId: string, input: { localBind: string; remoteHost: string; remotePort: number; ttlSeconds?: number }) {
        const app = await this.assertAllowedTarget(appId, input);
        const expiresAt = input.ttlSeconds ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString() : undefined;
        const session = privateNetworkService.createSession({
            appId: app.id,
            projectId: app.projectId,
            localBind: input.localBind,
            remoteHost: input.remoteHost,
            remotePort: input.remotePort,
            expiresAt,
        });
        sessions.set(session.sessionId, session);
        return session;
    }

    list(appId: string) {
        return [...sessions.values()].filter(session => session.appId === appId && (!session.expiresAt || Date.parse(session.expiresAt) > Date.now()));
    }

    get(appId: string, sessionId: string) {
        const session = sessions.get(sessionId);
        if (!session || session.appId !== appId || (session.expiresAt && Date.parse(session.expiresAt) <= Date.now())) {
            return null;
        }
        return session;
    }

    close(appId: string, sessionId: string) {
        const session = sessions.get(sessionId);
        if (!session || session.appId !== appId) {
            return null;
        }
        sessions.delete(sessionId);
        return session;
    }
}

const proxySessionService = new ProxySessionService();
export default proxySessionService;
