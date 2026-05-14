import appService from "./app.service";
import quickStackManagedService from "./quickstack-managed-service";
import appSecretEnvService from "./app-secret-env.service";
import dataAccess from "../adapter/db.client";
import type { AuditActor } from "./audit.service";
import { AppTemplateUtils } from "../utils/app-template.utils";
import type { ManagedServiceFamily } from "@/shared/model/agent-managed-service.model";
import { ServiceException } from "@/shared/model/service.exception.model";
import { defaultManagedSecretName, hostnameFromConnection, managedAppTypes, managedFamilyForAppType, managedFamilyForSecret } from "./managed-service.utils";

class ServiceAttachmentService {
    async listForApp(appId: string) {
        const app = await appService.getExtendedById(appId, false);
        const managedRows = await dataAccess.client.app.findMany({
            where: { projectId: app.projectId, appType: { in: [...managedAppTypes] } },
            select: { id: true },
        });
        const managedApps = await Promise.all(managedRows.map(row => appService.getExtendedById(row.id, false).catch(() => null)));
        const managedByHostname = new Map<string, { id: string; family: ManagedServiceFamily }>();
        for (const serviceApp of managedApps) {
            if (!serviceApp) continue;
            const family = managedFamilyForAppType(serviceApp.appType);
            if (!family) continue;
            const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(serviceApp);
            if (databaseInfo.hostname) managedByHostname.set(databaseInfo.hostname, { id: serviceApp.id, family });
        }
        return (app.appSecretEnvVars ?? [])
            .map(secret => {
                const value = appSecretEnvService.decryptForKubernetes(secret.encryptedValue);
                const hostname = hostnameFromConnection(value);
                const matched = hostname ? managedByHostname.get(hostname) : undefined;
                const family = matched?.family ?? managedFamilyForSecret(secret.name);
                if (!family) return null;
                return {
                    serviceId: matched?.id ?? secret.name,
                    family,
                    appId: app.id,
                    attachedAt: secret.createdAt instanceof Date ? secret.createdAt.toISOString() : String(secret.createdAt),
                    injectedEnvKeys: [],
                    injectedSecretKeys: [secret.name],
                };
            })
            .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment));
    }

    async attach(input: { appId: string; serviceId: string; secretName?: string; actor: AuditActor }) {
        const serviceApp = await appService.getById(input.serviceId);
        const family = managedFamilyForAppType(serviceApp.appType);
        if (family === 'postgres') return quickStackManagedService.attachPostgres({ databaseAppId: input.serviceId, appId: input.appId, secretName: input.secretName || defaultManagedSecretName(family), actor: input.actor });
        if (family === 'redis') return quickStackManagedService.attachRedis({ redisAppId: input.serviceId, appId: input.appId, secretName: input.secretName || defaultManagedSecretName(family), actor: input.actor });
        if (family === 'mysql') return quickStackManagedService.attachMysql({ mysqlAppId: input.serviceId, appId: input.appId, secretName: input.secretName || defaultManagedSecretName(family), actor: input.actor });
        throw new Error('Unsupported managed service family.');
    }

    async detach(input: { appId: string; serviceId: string; secretName?: string; actor?: AuditActor }) {
        const [serviceApp, app] = await Promise.all([
            appService.getExtendedById(input.serviceId, false).catch(() => null),
            appService.getExtendedById(input.appId, false),
        ]);
        if (!serviceApp) {
            throw new ServiceException('Managed service was not found. No secrets were changed.');
        }
        const family = managedFamilyForAppType(serviceApp.appType);
        if (!family) {
            throw new ServiceException('Service is not a supported managed service. No secrets were changed.');
        }
        if (serviceApp.projectId !== app.projectId) {
            throw new ServiceException('Managed service can only be detached from apps in the same project. No secrets were changed.');
        }

        const secretName = input.secretName || defaultManagedSecretName(family);
        const secret = (app.appSecretEnvVars ?? []).find(item => item.name === secretName);
        const serviceHostname = hostnameFromConnection(AppTemplateUtils.getDatabaseModelFromApp(serviceApp).internalConnectionUrl);
        const secretHostname = secret ? hostnameFromConnection(appSecretEnvService.decryptForKubernetes(secret.encryptedValue)) : undefined;
        const matchesService = Boolean(secret && serviceHostname && secretHostname === serviceHostname);
        if (matchesService && input.actor) {
            await appSecretEnvService.deleteMany({ app, names: [secretName], actor: input.actor });
        }
        return { appId: app.id, serviceId: serviceApp.id, detached: matchesService, injectedSecretKeys: matchesService ? [secretName] : [] };
    }
}

const serviceAttachmentService = new ServiceAttachmentService();
export default serviceAttachmentService;
