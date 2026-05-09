import { z } from "zod";
import { AppBasicAuthModel, AppDomainModel, AppFileMountModel, AppModel, AppNodePortModel, AppPortModel, AppPublicEndpointModel, AppVolumeModel, ProjectModel, VolumeBackupModel } from "./generated-zod";
import { App, Project } from "@prisma/client";

export const AppSecretEnvVarModel = z.object({
    id: z.string(),
    appId: z.string(),
    name: z.string(),
    encryptedValue: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const AppExtendedZodModel= z.lazy(() => AppModel.extend({
    project: ProjectModel,
    appDomains: AppDomainModel.array(),
    appPorts: AppPortModel.array(),
    appNodePorts: AppNodePortModel.array(),
    appPublicEndpoints: AppPublicEndpointModel.array(),
    appFileMounts: AppFileMountModel.array(),
    appVolumes: AppVolumeModel.array(),
    appBasicAuths: AppBasicAuthModel.array(),
    appSecretEnvVars: AppSecretEnvVarModel.array().optional().default([]),
  }))

export type AppExtendedModel = z.infer<typeof AppExtendedZodModel>;

export type AppWithProjectModel = App & {
    project: Project;
}