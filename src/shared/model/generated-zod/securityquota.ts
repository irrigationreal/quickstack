import * as z from "zod"


export const SecurityQuotaModel = z.object({
  id: z.string(),
  scope: z.string(),
  projectId: z.string().nullish(),
  maxAppsPerProject: z.number().int().nullish(),
  maxReplicasPerApp: z.number().int().nullish(),
  maxMemoryLimitMbPerReplica: z.number().int().nullish(),
  maxCpuLimitMillicoresPerReplica: z.number().int().nullish(),
  maxTotalMemoryLimitMbPerProject: z.number().int().nullish(),
  maxTotalCpuLimitMillicoresPerProject: z.number().int().nullish(),
  maxDeploysPerUserPerHour: z.number().int().nullish(),
  maxDeploysPerAppPerHour: z.number().int().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
