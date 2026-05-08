import * as z from "zod"


export const DeployQuotaWindowModel = z.object({
  id: z.string(),
  scopeType: z.string(),
  scopeId: z.string(),
  windowStart: z.date(),
  count: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
