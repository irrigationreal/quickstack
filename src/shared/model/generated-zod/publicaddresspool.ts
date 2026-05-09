import * as z from "zod"

import { CompleteProject, RelatedProjectModel } from "./index"

export const PublicAddressPoolModel = z.object({
  id: z.string(),
  projectId: z.string().nullish(),
  name: z.string(),
  addressesJson: z.string(),
  purpose: z.string(),
  enabled: z.boolean(),
  notes: z.string().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export interface CompletePublicAddressPool extends z.infer<typeof PublicAddressPoolModel> {
  project?: CompleteProject | null
}

/**
 * RelatedPublicAddressPoolModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedPublicAddressPoolModel: z.ZodSchema<CompletePublicAddressPool> = z.lazy(() => PublicAddressPoolModel.extend({
  project: RelatedProjectModel.nullish(),
}))
