import * as z from "zod"

import { CompleteUser, RelatedUserModel } from "./index"

export const AuditEventModel = z.object({
  id: z.string(),
  createdAt: z.date(),
  actorUserId: z.string().nullish(),
  actorEmail: z.string(),
  actorGroupName: z.string().nullish(),
  actorType: z.string(),
  action: z.string(),
  outcome: z.string(),
  targetType: z.string(),
  targetId: z.string().nullish(),
  projectId: z.string().nullish(),
  projectName: z.string().nullish(),
  appId: z.string().nullish(),
  appName: z.string().nullish(),
  deploymentId: z.string().nullish(),
  apiKeyId: z.string().nullish(),
  apiKeyName: z.string().nullish(),
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
  message: z.string().nullish(),
  metadataJson: z.string().nullish(),
})

export interface CompleteAuditEvent extends z.infer<typeof AuditEventModel> {
  actorUser?: CompleteUser | null
}

/**
 * RelatedAuditEventModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedAuditEventModel: z.ZodSchema<CompleteAuditEvent> = z.lazy(() => AuditEventModel.extend({
  actorUser: RelatedUserModel.nullish(),
}))
