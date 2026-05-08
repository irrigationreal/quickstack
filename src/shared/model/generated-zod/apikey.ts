import * as z from "zod"

import { CompleteUser, RelatedUserModel } from "./index"

export const ApiKeyModel = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  prefix: z.string(),
  keyHash: z.string(),
  scopes: z.string(),
  appIdsJson: z.string().nullish(),
  projectIdsJson: z.string().nullish(),
  lastUsedAt: z.date().nullish(),
  revokedAt: z.date().nullish(),
  expiresAt: z.date().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export interface CompleteApiKey extends z.infer<typeof ApiKeyModel> {
  user: CompleteUser
}

/**
 * RelatedApiKeyModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedApiKeyModel: z.ZodSchema<CompleteApiKey> = z.lazy(() => ApiKeyModel.extend({
  user: RelatedUserModel,
}))
