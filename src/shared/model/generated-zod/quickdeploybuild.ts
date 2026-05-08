import * as z from "zod"

import { CompleteApp, RelatedAppModel, CompleteProject, RelatedProjectModel } from "./index"

export const QuickDeployBuildModel = z.object({
  id: z.string(),
  appId: z.string(),
  projectId: z.string(),
  mode: z.string(),
  contentHash: z.string(),
  imageReference: z.string().nullish(),
  status: z.string(),
  uploadBytes: z.number().int(),
  createdByApiKeyId: z.string().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export interface CompleteQuickDeployBuild extends z.infer<typeof QuickDeployBuildModel> {
  app: CompleteApp
  project: CompleteProject
}

/**
 * RelatedQuickDeployBuildModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedQuickDeployBuildModel: z.ZodSchema<CompleteQuickDeployBuild> = z.lazy(() => QuickDeployBuildModel.extend({
  app: RelatedAppModel,
  project: RelatedProjectModel,
}))
