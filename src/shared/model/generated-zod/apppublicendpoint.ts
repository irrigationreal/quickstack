import * as z from "zod"

import { CompleteApp, RelatedAppModel } from "./index"

export const AppPublicEndpointModel = z.object({
  id: z.string(),
  appId: z.string(),
  name: z.string().nullish(),
  publicIp: z.string(),
  publicPort: z.number().int(),
  targetPort: z.number().int(),
  protocol: z.string(),
  sourceCidrsJson: z.string().nullish(),
  proxyProtocol: z.boolean(),
  enabled: z.boolean(),
  status: z.string(),
  lastError: z.string().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export interface CompleteAppPublicEndpoint extends z.infer<typeof AppPublicEndpointModel> {
  app: CompleteApp
}

/**
 * RelatedAppPublicEndpointModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedAppPublicEndpointModel: z.ZodSchema<CompleteAppPublicEndpoint> = z.lazy(() => AppPublicEndpointModel.extend({
  app: RelatedAppModel,
}))
