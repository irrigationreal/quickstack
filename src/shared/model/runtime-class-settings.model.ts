import { z } from "zod";
import { runtimeClassNameZodModel } from "./app-container-config.model";

export const runtimeClassSettingsZodModel = z.object({
    defaultAppRuntimeClass: runtimeClassNameZodModel,
});

export type RuntimeClassSettingsModel = z.infer<typeof runtimeClassSettingsZodModel>;

export type RuntimeClassNodeHealthModel = {
    nodeName: string;
    healthy: boolean;
    runtimeProof: string | null;
    podPhase: string | null;
    message: string;
};

export type RuntimeClassHealthModel = {
    runtimeClassName: string;
    healthy: boolean;
    checkedAt: Date;
    nodeName: string | null;
    runtimeProof: string | null;
    message: string;
    maxAgeSeconds?: number;
    nodes?: RuntimeClassNodeHealthModel[];
};

export type RuntimeClassInfoModel = {
    name: string;
    handler: string;
    hasScheduling: boolean;
    hasOverhead: boolean;
    isKata?: boolean;
    health?: RuntimeClassHealthModel | null;
};

export type RuntimeClassSettingsViewModel = RuntimeClassSettingsModel & {
    runtimeClasses: RuntimeClassInfoModel[];
};
