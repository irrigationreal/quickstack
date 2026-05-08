import { z } from "zod";
import { runtimeClassNameZodModel } from "./app-container-config.model";

export const runtimeClassSettingsZodModel = z.object({
    defaultAppRuntimeClass: runtimeClassNameZodModel,
});

export type RuntimeClassSettingsModel = z.infer<typeof runtimeClassSettingsZodModel>;

export type RuntimeClassInfoModel = {
    name: string;
    handler: string;
    hasScheduling: boolean;
    hasOverhead: boolean;
};

export type RuntimeClassSettingsViewModel = RuntimeClassSettingsModel & {
    runtimeClasses: RuntimeClassInfoModel[];
};
