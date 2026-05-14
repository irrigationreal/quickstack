import { Prisma, SecurityQuota } from "@prisma/client";
import { revalidateTag, unstable_cache } from "next/cache";
import dataAccess from "../adapter/db.client";
import { Tags } from "../utils/cache-tag-generator.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { SecurityQuotaModel } from "@/shared/model/security-quota.model";
import { AuditEventInput } from "./audit.service";

export type DeployQuotaActorContext = Pick<AuditEventInput, "actorType" | "actorUserId" | "actorEmail">;

const GLOBAL_QUOTA_ID = "global";

function startOfCurrentHour() {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    return date;
}

function boundedPositiveLimit(limit?: number | null) {
    return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : null;
}

class SecurityQuotaService {
    async getProjectQuotaDiagnostics(projectId?: string | null) {
        if (!projectId) {
            return {
                apps: { check: 'quota_apps', code: 'quota.apps', status: 'ok' as const, message: 'No project selected; app quota was not evaluated.' },
                volumes: { check: 'quota_volumes', code: 'quota.volumes', status: 'ok' as const, message: 'No project selected; volume usage was not evaluated.' },
                managedServices: { check: 'quota_managed_services', code: 'quota.managed_services', status: 'ok' as const, message: 'No project selected; managed service usage was not evaluated.' },
            };
        }

        const quota = await this.getEffectiveQuota(projectId);
        const maxApps = boundedPositiveLimit(quota?.maxAppsPerProject);
        const [appCount, volumes] = await Promise.all([
            dataAccess.client.app.count({ where: { projectId } }),
            dataAccess.client.appVolume.findMany({ where: { app: { projectId } }, select: { size: true } }),
        ]);
        const volumeTotalGi = volumes.reduce((sum, volume) => sum + volume.size, 0);

        const appStatus = maxApps && appCount >= maxApps ? 'error' : maxApps && appCount >= Math.ceil(maxApps * 0.8) ? 'warning' : 'ok';
        const appMessage = maxApps
            ? `Project ${projectId} is using ${appCount}/${maxApps} app slots.`
            : `Project ${projectId} has ${appCount} app(s); no app quota is configured.`;

        return {
            apps: {
                check: 'quota_apps',
                code: 'quota.apps',
                status: appStatus as 'ok' | 'warning' | 'error',
                message: appMessage,
                remediation: appStatus === 'error' ? 'Delete unused apps or ask an admin to raise the quota.' : appStatus === 'warning' ? 'Review unused apps before the next deployment.' : undefined,
            },
            volumes: { check: 'quota_volumes', code: 'quota.volumes', status: 'ok' as const, message: `Project ${projectId} has ${volumeTotalGi} GiB of declared volume capacity; no volume quota is configured.` },
            managedServices: { check: 'quota_managed_services', code: 'quota.managed_services', status: 'ok' as const, message: 'Managed service quota is not configured for this project.' },
        };
    }

    async getEffectiveQuota(projectId?: string | null): Promise<SecurityQuota | null> {
        return unstable_cache(async () => {
            const scopedQuota = projectId ? await dataAccess.client.securityQuota.findFirst({
                where: {
                    scope: "PROJECT",
                    projectId,
                }
            }) : null;
            if (scopedQuota) {
                return scopedQuota;
            }
            return dataAccess.client.securityQuota.findUnique({
                where: {
                    id: GLOBAL_QUOTA_ID,
                }
            });
        }, [Tags.securityQuotas(), projectId ?? "global"], {
            tags: [Tags.securityQuotas()]
        })();
    }

    async getGlobalQuotaModel(): Promise<SecurityQuotaModel> {
        const quota = await this.getEffectiveQuota();
        return {
            id: quota?.id,
            maxAppsPerProject: quota?.maxAppsPerProject ?? undefined,
            maxReplicasPerApp: quota?.maxReplicasPerApp ?? undefined,
            maxMemoryLimitMbPerReplica: quota?.maxMemoryLimitMbPerReplica ?? undefined,
            maxCpuLimitMillicoresPerReplica: quota?.maxCpuLimitMillicoresPerReplica ?? undefined,
            maxTotalMemoryLimitMbPerProject: quota?.maxTotalMemoryLimitMbPerProject ?? undefined,
            maxTotalCpuLimitMillicoresPerProject: quota?.maxTotalCpuLimitMillicoresPerProject ?? undefined,
            maxDeploysPerUserPerHour: quota?.maxDeploysPerUserPerHour ?? undefined,
            maxDeploysPerAppPerHour: quota?.maxDeploysPerAppPerHour ?? undefined,
            maxQuickDeployUploadBytes: quota?.maxQuickDeployUploadBytes ?? undefined,
            maxQuickDeployUploadBytesPerHour: quota?.maxQuickDeployUploadBytesPerHour ?? undefined,
            maxQuickDeployBuildsPerUserPerHour: quota?.maxQuickDeployBuildsPerUserPerHour ?? undefined,
            maxConcurrentQuickDeployBuilds: quota?.maxConcurrentQuickDeployBuilds ?? undefined,
        };
    }

    async saveGlobalQuota(input: SecurityQuotaModel) {
        const saved = await dataAccess.client.securityQuota.upsert({
            where: {
                id: GLOBAL_QUOTA_ID,
            },
            update: {
                scope: "GLOBAL",
                projectId: null,
                maxAppsPerProject: input.maxAppsPerProject ?? null,
                maxReplicasPerApp: input.maxReplicasPerApp ?? null,
                maxMemoryLimitMbPerReplica: input.maxMemoryLimitMbPerReplica ?? null,
                maxCpuLimitMillicoresPerReplica: input.maxCpuLimitMillicoresPerReplica ?? null,
                maxTotalMemoryLimitMbPerProject: input.maxTotalMemoryLimitMbPerProject ?? null,
                maxTotalCpuLimitMillicoresPerProject: input.maxTotalCpuLimitMillicoresPerProject ?? null,
                maxDeploysPerUserPerHour: input.maxDeploysPerUserPerHour ?? null,
                maxDeploysPerAppPerHour: input.maxDeploysPerAppPerHour ?? null,
                maxQuickDeployUploadBytes: input.maxQuickDeployUploadBytes ?? null,
                maxQuickDeployUploadBytesPerHour: input.maxQuickDeployUploadBytesPerHour ?? null,
                maxQuickDeployBuildsPerUserPerHour: input.maxQuickDeployBuildsPerUserPerHour ?? null,
                maxConcurrentQuickDeployBuilds: input.maxConcurrentQuickDeployBuilds ?? null,
            },
            create: {
                id: GLOBAL_QUOTA_ID,
                scope: "GLOBAL",
                maxAppsPerProject: input.maxAppsPerProject ?? null,
                maxReplicasPerApp: input.maxReplicasPerApp ?? null,
                maxMemoryLimitMbPerReplica: input.maxMemoryLimitMbPerReplica ?? null,
                maxCpuLimitMillicoresPerReplica: input.maxCpuLimitMillicoresPerReplica ?? null,
                maxTotalMemoryLimitMbPerProject: input.maxTotalMemoryLimitMbPerProject ?? null,
                maxTotalCpuLimitMillicoresPerProject: input.maxTotalCpuLimitMillicoresPerProject ?? null,
                maxDeploysPerUserPerHour: input.maxDeploysPerUserPerHour ?? null,
                maxDeploysPerAppPerHour: input.maxDeploysPerAppPerHour ?? null,
                maxQuickDeployUploadBytes: input.maxQuickDeployUploadBytes ?? null,
                maxQuickDeployUploadBytesPerHour: input.maxQuickDeployUploadBytesPerHour ?? null,
                maxQuickDeployBuildsPerUserPerHour: input.maxQuickDeployBuildsPerUserPerHour ?? null,
                maxConcurrentQuickDeployBuilds: input.maxConcurrentQuickDeployBuilds ?? null,
            }
        });
        revalidateTag(Tags.securityQuotas());
        return saved;
    }

    async assertProjectCanCreateApp(projectId: string, tx?: Prisma.TransactionClient) {
        const quota = await this.getEffectiveQuota(projectId);
        const maxApps = boundedPositiveLimit(quota?.maxAppsPerProject);
        if (!maxApps) {
            return;
        }
        const client = tx ?? dataAccess.client;
        const existingApps = await client.app.count({
            where: {
                projectId,
            }
        });
        if (existingApps >= maxApps) {
            throw new ServiceException(`Project app quota exceeded. This project can have at most ${maxApps} app(s).`);
        }
    }

    async assertAppResourceLimits(appId: string | undefined, proposed: {
        projectId?: string | null;
        replicas?: number | null;
        memoryLimit?: number | null;
        cpuLimit?: number | null;
    }, tx?: Prisma.TransactionClient) {
        if (!proposed.projectId) {
            return;
        }
        const quota = await this.getEffectiveQuota(proposed.projectId);
        if (!quota) {
            return;
        }
        const client = tx ?? dataAccess.client;
        const existingApp = appId ? await client.app.findFirst({
            where: {
                id: appId
            }
        }) : null;
        const replicas = proposed.replicas ?? existingApp?.replicas ?? 1;
        const memoryLimit = proposed.memoryLimit ?? existingApp?.memoryLimit ?? null;
        const cpuLimit = proposed.cpuLimit ?? existingApp?.cpuLimit ?? null;

        const maxReplicas = boundedPositiveLimit(quota.maxReplicasPerApp);
        if (maxReplicas && replicas > maxReplicas) {
            throw new ServiceException(`Replica quota exceeded. Apps can have at most ${maxReplicas} replica(s).`);
        }
        const maxMemoryPerReplica = boundedPositiveLimit(quota.maxMemoryLimitMbPerReplica);
        if (maxMemoryPerReplica && memoryLimit !== null && memoryLimit > maxMemoryPerReplica) {
            throw new ServiceException(`Memory quota exceeded. Apps can use at most ${maxMemoryPerReplica} MB per replica.`);
        }
        const maxCpuPerReplica = boundedPositiveLimit(quota.maxCpuLimitMillicoresPerReplica);
        if (maxCpuPerReplica && cpuLimit !== null && cpuLimit > maxCpuPerReplica) {
            throw new ServiceException(`CPU quota exceeded. Apps can use at most ${maxCpuPerReplica}m per replica.`);
        }

        const projectApps = await client.app.findMany({
            where: {
                projectId: proposed.projectId,
                id: appId ? { not: appId } : undefined,
            },
            select: {
                replicas: true,
                memoryLimit: true,
                cpuLimit: true,
            }
        });
        const proposedTotalMemory = projectApps.reduce((sum, app) => sum + ((app.memoryLimit ?? 0) * app.replicas), (memoryLimit ?? 0) * replicas);
        const maxTotalMemory = boundedPositiveLimit(quota.maxTotalMemoryLimitMbPerProject);
        if (maxTotalMemory && proposedTotalMemory > maxTotalMemory) {
            throw new ServiceException(`Project memory quota exceeded. Project apps can reserve at most ${maxTotalMemory} MB total.`);
        }
        const proposedTotalCpu = projectApps.reduce((sum, app) => sum + ((app.cpuLimit ?? 0) * app.replicas), (cpuLimit ?? 0) * replicas);
        const maxTotalCpu = boundedPositiveLimit(quota.maxTotalCpuLimitMillicoresPerProject);
        if (maxTotalCpu && proposedTotalCpu > maxTotalCpu) {
            throw new ServiceException(`Project CPU quota exceeded. Project apps can reserve at most ${maxTotalCpu}m total.`);
        }
    }

    private async incrementHourlyQuota(context: {
        scopeType: string;
        scopeId: string;
        limit: number;
        incrementBy?: number;
        tx: Prisma.TransactionClient;
        message: string;
    }) {
        const windowStart = startOfCurrentHour();
        await context.tx.deployQuotaWindow.upsert({
            where: {
                scopeType_scopeId_windowStart: {
                    scopeType: context.scopeType,
                    scopeId: context.scopeId,
                    windowStart,
                }
            },
            update: {},
            create: {
                scopeType: context.scopeType,
                scopeId: context.scopeId,
                windowStart,
                count: 0,
            }
        });
        const updated = await context.tx.deployQuotaWindow.updateMany({
            where: {
                scopeType: context.scopeType,
                scopeId: context.scopeId,
                windowStart,
                count: {
                    lte: context.limit - (context.incrementBy ?? 1)
                }
            },
            data: {
                count: {
                    increment: context.incrementBy ?? 1
                }
            }
        });
        if (updated.count !== 1) {
            throw new ServiceException(context.message);
        }
    }

    async reserveDeployQuota(context: {
        actor: DeployQuotaActorContext;
        appId: string;
        quota: SecurityQuota | null;
        tx: Prisma.TransactionClient;
    }) {
        const reservations: Array<{ scopeType: string; scopeId: string; limit: number }> = [];
        const perAppLimit = boundedPositiveLimit(context.quota?.maxDeploysPerAppPerHour);
        if (perAppLimit) {
            reservations.push({ scopeType: "APP", scopeId: context.appId, limit: perAppLimit });
        }
        const perUserLimit = boundedPositiveLimit(context.quota?.maxDeploysPerUserPerHour);
        if (perUserLimit && context.actor.actorType === "USER" && context.actor.actorUserId) {
            reservations.push({ scopeType: "USER", scopeId: context.actor.actorUserId, limit: perUserLimit });
        }

        for (const reservation of reservations) {
            await this.incrementHourlyQuota({
                ...reservation,
                tx: context.tx,
                message: `${reservation.scopeType.toLowerCase()} deploy quota exceeded. Limit is ${reservation.limit} deploy(s) per hour.`,
            });
        }
    }

    async reserveQuickDeployUploadQuota(context: {
        actor: DeployQuotaActorContext;
        projectId: string;
        uploadBytes: number;
        tx: Prisma.TransactionClient;
    }) {
        const quota = await this.getEffectiveQuota(context.projectId);
        const maxSingleUpload = boundedPositiveLimit(quota?.maxQuickDeployUploadBytes);
        if (maxSingleUpload && context.uploadBytes > maxSingleUpload) {
            throw new ServiceException(`QuickDeploy upload quota exceeded. A single upload can be at most ${maxSingleUpload} byte(s).`);
        }

        const userId = context.actor.actorUserId;
        if (!userId) {
            return;
        }

        const maxBytesPerHour = boundedPositiveLimit(quota?.maxQuickDeployUploadBytesPerHour);
        if (maxBytesPerHour) {
            await this.incrementHourlyQuota({
                scopeType: "QUICKDEPLOY_UPLOAD_BYTES_USER",
                scopeId: userId,
                limit: maxBytesPerHour,
                incrementBy: context.uploadBytes,
                tx: context.tx,
                message: `QuickDeploy upload byte quota exceeded. Limit is ${maxBytesPerHour} byte(s) per hour.`,
            });
        }

        const maxBuildsPerHour = boundedPositiveLimit(quota?.maxQuickDeployBuildsPerUserPerHour);
        if (maxBuildsPerHour) {
            await this.incrementHourlyQuota({
                scopeType: "QUICKDEPLOY_BUILDS_USER",
                scopeId: userId,
                limit: maxBuildsPerHour,
                tx: context.tx,
                message: `QuickDeploy build quota exceeded. Limit is ${maxBuildsPerHour} build(s) per hour.`,
            });
        }

        const maxConcurrentBuilds = boundedPositiveLimit(quota?.maxConcurrentQuickDeployBuilds);
        if (maxConcurrentBuilds) {
            const concurrentBuilds = await context.tx.quickDeployBuild.count({
                where: {
                    projectId: context.projectId,
                    status: {
                        in: ["UPLOADED", "QUEUED", "RUNNING"]
                    }
                }
            });
            if (concurrentBuilds >= maxConcurrentBuilds) {
                throw new ServiceException(`QuickDeploy concurrent build quota exceeded. Limit is ${maxConcurrentBuilds} pending or running build(s).`);
            }
        }
    }
}

const securityQuotaService = new SecurityQuotaService();
export default securityQuotaService;
