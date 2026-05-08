import * as z from "zod"

import { CompleteApp, RelatedAppModel } from "./index"

export const AppSecretEnvVarModel = z.object({
  id: z.string(),
  appId: z.string(),
  name: z.string(),
  encryptedValue: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export interface CompleteAppSecretEnvVar extends z.infer<typeof AppSecretEnvVarModel> {
  app: CompleteApp
}

/**
 * RelatedAppSecretEnvVarModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedAppSecretEnvVarModel: z.ZodSchema<CompleteAppSecretEnvVar> = z.lazy(() => AppSecretEnvVarModel.extend({
  app: RelatedAppModel,
}))
