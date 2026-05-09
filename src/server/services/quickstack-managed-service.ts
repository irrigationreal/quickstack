import appService from "./app.service";
import appSecretEnvService from "./app-secret-env.service";
import auditService, { AuditActor } from "./audit.service";
import { AppTemplateUtils } from "../utils/app-template.utils";
import { getPostgresAppTemplate } from "@/shared/templates/databases/postgres.template";
import { getRedisAppTemplate } from "@/shared/templates/databases/redis.template";
import { ServiceException } from "@/shared/model/service.exception.model";
import { Prisma } from "@prisma/client";
import dataAccess from "../adapter/db.client";

class QuickStackManagedService {
    async createRedis(input: {
        projectId: string;
        name?: string;
        actor: AuditActor;
    }) {
        const password = AppTemplateUtils.generateStrongPasswort(35);
        const template = getRedisAppTemplate({ appName: input.name || 'Redis' });
        const mappedApp = AppTemplateUtils.mapTemplateInputValuesToApp(template, template.inputSettings);
        mappedApp.containerArgs = JSON.stringify(['--requirepass', password]);

        const appId = await dataAccess.client.$transaction(async (tx: Prisma.TransactionClient) => {
            const created = await appService.save({
                ...mappedApp,
                name: input.name || mappedApp.name,
                projectId: input.projectId,
            }, false, tx);
            for (const volume of template.appVolumes) {
                await appService.saveVolume({ ...volume, appId: created.id }, tx);
            }
            for (const port of template.appPorts) {
                await appService.savePort({ ...port, appId: created.id }, tx);
            }
            return created.id;
        });

        const redisApp = await appService.getExtendedById(appId, false);
        const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(redisApp);
        await auditService.recordBestEffort({
            ...input.actor,
            action: 'MANAGED_REDIS_CREATED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: redisApp.id,
            projectId: redisApp.projectId,
            appId: redisApp.id,
            appName: redisApp.name,
            metadata: {
                hostname: databaseInfo.hostname,
                port: databaseInfo.port,
            },
        });
        return { redisApp, databaseInfo };
    }

    async listRedis(projectId: string) {
        const rows = await dataAccess.client.app.findMany({
            where: {
                projectId,
                appType: 'REDIS',
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                projectId: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const resources = [];
        for (const row of rows) {
            const app = await appService.getExtendedById(row.id, false);
            const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(app);
            resources.push({
                id: row.id,
                name: row.name,
                projectId: row.projectId,
                hostname: databaseInfo.hostname,
                port: databaseInfo.port,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            });
        }
        return resources;
    }

    async destroyRedis(input: {
        redisAppId: string;
        actor: AuditActor;
    }) {
        const redisApp = await appService.getById(input.redisAppId);
        if (redisApp.appType !== 'REDIS') {
            throw new ServiceException('Managed resource is not a Redis app.');
        }
        await appService.deleteById(redisApp.id);
        await auditService.recordBestEffort({
            ...input.actor,
            action: 'MANAGED_REDIS_DESTROYED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: redisApp.id,
            projectId: redisApp.projectId,
            appId: redisApp.id,
            appName: redisApp.name,
        });
        return {
            redisAppId: redisApp.id,
            projectId: redisApp.projectId,
            name: redisApp.name,
        };
    }

    async attachRedis(input: {
        redisAppId: string;
        appId: string;
        secretName?: string;
        actor: AuditActor;
    }) {
        const [redisApp, app] = await Promise.all([
            appService.getExtendedById(input.redisAppId, false),
            appService.getById(input.appId),
        ]);
        if (redisApp.appType !== 'REDIS') {
            throw new ServiceException('Managed resource is not a Redis app.');
        }
        if (redisApp.projectId !== app.projectId) {
            throw new ServiceException('Managed Redis can only be attached to apps in the same project.');
        }
        const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(redisApp);
        const secretName = input.secretName || 'REDIS_URL';
        await appSecretEnvService.upsertMany({
            app,
            secrets: [{ name: secretName, value: databaseInfo.internalConnectionUrl }],
            actor: input.actor,
        });
        await auditService.recordBestEffort({
            ...input.actor,
            action: 'MANAGED_REDIS_ATTACHED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: input.appId,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            metadata: {
                redisAppId: redisApp.id,
                secretName,
            },
        });
        return {
            appId: app.id,
            redisAppId: redisApp.id,
            secretName,
            redis: {
                hostname: databaseInfo.hostname,
                port: databaseInfo.port,
            },
        };
    }

    async createPostgres(input: {
        projectId: string;
        name?: string;
        databaseName?: string;
        username?: string;
        actor: AuditActor;
    }) {
        const dbPassword = AppTemplateUtils.generateStrongPasswort(35);
        const template = getPostgresAppTemplate({
            appName: input.name || 'PostgreSQL',
            dbName: input.databaseName || 'postgresdb',
            dbUsername: input.username || 'postgresuser',
            dbPassword,
        });
        const mappedApp = AppTemplateUtils.mapTemplateInputValuesToApp(template, template.inputSettings);

        const appId = await dataAccess.client.$transaction(async (tx: Prisma.TransactionClient) => {
            const created = await appService.save({
                ...mappedApp,
                name: input.name || mappedApp.name,
                projectId: input.projectId,
            }, false, tx);
            for (const volume of template.appVolumes) {
                await appService.saveVolume({ ...volume, appId: created.id }, tx);
            }
            for (const port of template.appPorts) {
                await appService.savePort({ ...port, appId: created.id }, tx);
            }
            return created.id;
        });

        const databaseApp = await appService.getExtendedById(appId, false);
        const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(databaseApp);
        await auditService.recordBestEffort({
            ...input.actor,
            action: 'MANAGED_POSTGRES_CREATED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: databaseApp.id,
            projectId: databaseApp.projectId,
            appId: databaseApp.id,
            appName: databaseApp.name,
            metadata: {
                databaseName: databaseInfo.databaseName,
                hostname: databaseInfo.hostname,
                port: databaseInfo.port,
            },
        });
        return { databaseApp, databaseInfo };
    }

    async listPostgres(projectId: string) {
        const rows = await dataAccess.client.app.findMany({
            where: {
                projectId,
                appType: 'POSTGRES',
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                projectId: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const databases = [];
        for (const row of rows) {
            const app = await appService.getExtendedById(row.id, false);
            const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(app);
            databases.push({
                id: row.id,
                name: row.name,
                projectId: row.projectId,
                databaseName: databaseInfo.databaseName,
                username: databaseInfo.username,
                hostname: databaseInfo.hostname,
                port: databaseInfo.port,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            });
        }
        return databases;
    }

    async destroyPostgres(input: {
        databaseAppId: string;
        actor: AuditActor;
    }) {
        const databaseApp = await appService.getById(input.databaseAppId);
        if (databaseApp.appType !== 'POSTGRES') {
            throw new ServiceException('Managed resource is not a Postgres app.');
        }
        await appService.deleteById(databaseApp.id);
        await auditService.recordBestEffort({
            ...input.actor,
            action: 'MANAGED_POSTGRES_DESTROYED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: databaseApp.id,
            projectId: databaseApp.projectId,
            appId: databaseApp.id,
            appName: databaseApp.name,
        });
        return {
            databaseAppId: databaseApp.id,
            projectId: databaseApp.projectId,
            name: databaseApp.name,
        };
    }

    async attachPostgres(input: {
        databaseAppId: string;
        appId: string;
        secretName?: string;
        actor: AuditActor;
    }) {
        const [databaseApp, app] = await Promise.all([
            appService.getExtendedById(input.databaseAppId, false),
            appService.getById(input.appId),
        ]);
        if (databaseApp.appType !== 'POSTGRES') {
            throw new ServiceException('Managed resource is not a Postgres app.');
        }
        if (databaseApp.projectId !== app.projectId) {
            throw new ServiceException('Managed Postgres can only be attached to apps in the same project.');
        }
        const databaseInfo = AppTemplateUtils.getDatabaseModelFromApp(databaseApp);
        const secretName = input.secretName || 'DATABASE_URL';
        await appSecretEnvService.upsertMany({
            app,
            secrets: [{ name: secretName, value: databaseInfo.internalConnectionUrl }],
            actor: input.actor,
        });
        await auditService.recordBestEffort({
            ...input.actor,
            action: 'MANAGED_POSTGRES_ATTACHED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: input.appId,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            metadata: {
                databaseAppId: databaseApp.id,
                secretName,
            },
        });
        return {
            appId: app.id,
            databaseAppId: databaseApp.id,
            secretName,
            database: {
                databaseName: databaseInfo.databaseName,
                hostname: databaseInfo.hostname,
                port: databaseInfo.port,
            },
        };
    }
}

const quickStackManagedService = new QuickStackManagedService();
export default quickStackManagedService;
