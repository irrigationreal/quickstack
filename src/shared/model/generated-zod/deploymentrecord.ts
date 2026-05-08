import * as z from "zod"

import { CompleteUser, RelatedUserModel } from "./index"

export const DeploymentRecordModel = z.object({
  deploymentId: z.string(),
  appId: z.string(),
  appName: z.string().nullish(),
  projectId: z.string(),
  projectName: z.string().nullish(),
  actorUserId: z.string().nullish(),
  actorEmail: z.string(),
  actorType: z.string(),
  trigger: z.string(),
  apiKeyId: z.string().nullish(),
  apiKeyName: z.string().nullish(),
  forceBuild: z.boolean(),
  sourceType: z.string().nullish(),
  buildMethod: z.string().nullish(),
  status: z.string(),
  gitCommitHash: z.string().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export interface CompleteDeploymentRecord extends z.infer<typeof DeploymentRecordModel> {
  actorUser?: CompleteUser | null
}

/**
 * RelatedDeploymentRecordModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedDeploymentRecordModel: z.ZodSchema<CompleteDeploymentRecord> = z.lazy(() => DeploymentRecordModel.extend({
  actorUser: RelatedUserModel.nullish(),
}))
