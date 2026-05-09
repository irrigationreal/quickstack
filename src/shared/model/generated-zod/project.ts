import * as z from "zod"

import { CompleteApp, RelatedAppModel, CompleteQuickDeployBuild, RelatedQuickDeployBuildModel, CompleteRoleProjectPermission, RelatedRoleProjectPermissionModel, CompletePublicAddressPool, RelatedPublicAddressPoolModel } from "./index"

export const ProjectModel = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export interface CompleteProject extends z.infer<typeof ProjectModel> {
  apps: CompleteApp[]
  quickDeployBuilds: CompleteQuickDeployBuild[]
  roleProjectPermissions: CompleteRoleProjectPermission[]
  publicAddressPools: CompletePublicAddressPool[]
}

/**
 * RelatedProjectModel contains all relations on your model in addition to the scalars
 *
 * NOTE: Lazy required in case of potential circular dependencies within schema
 */
export const RelatedProjectModel: z.ZodSchema<CompleteProject> = z.lazy(() => ProjectModel.extend({
  apps: RelatedAppModel.array(),
  quickDeployBuilds: RelatedQuickDeployBuildModel.array(),
  roleProjectPermissions: RelatedRoleProjectPermissionModel.array(),
  publicAddressPools: RelatedPublicAddressPoolModel.array(),
}))
