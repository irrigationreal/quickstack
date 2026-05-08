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

    async reserveDeployQuota(context: {
        actor: DeployQuotaActorContext;
        appId: string;
        quota: SecurityQuota | null;
        tx: Prisma.TransactionClient;
    }) {
        const windowStart = startOfCurrentHour();
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
            await context.tx.deployQuotaWindow.upsert({
                where: {
                    scopeType_scopeId_windowStart: {
                        scopeType: reservation.scopeType,
                        scopeId: reservation.scopeId,
                        windowStart,
                    }
                },
                update: {},
                create: {
                    scopeType: reservation.scopeType,
                    scopeId: reservation.scopeId,
                    windowStart,
                    count: 0,
                }
            });
            const updated = await context.tx.deployQuotaWindow.updateMany({
                where: {
                    scopeType: reservation.scopeType,
                    scopeId: reservation.scopeId,
                    windowStart,
                    count: {
                        lt: reservation.limit
                    }
                },
                data: {
                    count: {
                        increment: 1
                    }
                }
            });
            if (updated.count !== 1) {
                throw new ServiceException(`${reservation.scopeType.toLowerCase()} deploy quota exceeded. Limit is ${reservation.limit} deploy(s) per hour.`);
            }
        }
    }
}

const securityQuotaService = new SecurityQuotaService();
export default securityQuotaService;
