import { z } from "zod";
import { stringToOptionalNumber } from "@/shared/utils/zod.utils";

export const securityQuotaZodModel = z.object({
    id: z.string().optional(),
    maxAppsPerProject: stringToOptionalNumber,
    maxReplicasPerApp: stringToOptionalNumber,
    maxMemoryLimitMbPerReplica: stringToOptionalNumber,
    maxCpuLimitMillicoresPerReplica: stringToOptionalNumber,
    maxTotalMemoryLimitMbPerProject: stringToOptionalNumber,
    maxTotalCpuLimitMillicoresPerProject: stringToOptionalNumber,
    maxDeploysPerUserPerHour: stringToOptionalNumber,
    maxDeploysPerAppPerHour: stringToOptionalNumber,
    maxQuickDeployUploadBytes: stringToOptionalNumber,
    maxQuickDeployUploadBytesPerHour: stringToOptionalNumber,
    maxQuickDeployBuildsPerUserPerHour: stringToOptionalNumber,
    maxConcurrentQuickDeployBuilds: stringToOptionalNumber,
});

export type SecurityQuotaModel = z.infer<typeof securityQuotaZodModel>;
