import { z } from "zod";
import { ImageRefZodModel, BuildStrategyZodModel } from "./agent-build-strategy.model";

export const RolloutStateZodModel = z.enum(["pending", "progressing", "healthy", "failed", "timed_out"]);

export const ReleaseZodModel = z.object({
    id: z.string(),
    deploymentId: z.string(),
    image: ImageRefZodModel.optional(),
    strategy: BuildStrategyZodModel.optional(),
    status: RolloutStateZodModel,
    createdAt: z.string(),
    healthy: z.boolean(),
    message: z.string().optional(),
    priorReleaseId: z.string().optional(),
});

export const DeploymentStatusZodModel = z.object({
    deploymentId: z.string(),
    rolloutState: RolloutStateZodModel,
    message: z.string(),
    observedAt: z.string(),
});

export type RolloutState = z.infer<typeof RolloutStateZodModel>;
export type Release = z.infer<typeof ReleaseZodModel>;
export type DeploymentStatus = z.infer<typeof DeploymentStatusZodModel>;
