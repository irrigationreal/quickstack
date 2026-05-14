import { z } from "zod";

export const PlanEvidenceZodModel = z.object({
    kind: z.string().min(1),
    sourcePath: z.string().min(1),
    reason: z.string().min(1),
    value: z.unknown().optional(),
});

export const BuildStrategyRecommendationZodModel = z.object({
    strategy: z.enum(["source-tar", "local-docker", "existing-image", "remote-builder"]),
    reason: z.string().min(1),
    priority: z.number().int().positive(),
});

export const PlanQuestionZodModel = z.object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});

export const PlanWarningZodModel = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
});

export const AgentLaunchPlanZodModel = z.object({
    framework: z.string().nullable(),
    serviceRoot: z.string(),
    ports: z.array(z.number().int().min(1).max(65535)),
    outputDir: z.string().optional(),
    evidence: z.array(PlanEvidenceZodModel),
    buildStrategies: z.array(BuildStrategyRecommendationZodModel),
    questions: z.array(PlanQuestionZodModel),
    warnings: z.array(PlanWarningZodModel),
});

export const AgentLaunchPlanRequestZodModel = z.object({
    root: z.string().optional(),
    flags: z.object({
        image: z.string().optional(),
        serviceRoot: z.string().optional(),
        remoteBuilder: z.boolean().optional(),
    }).default({}),
    evidence: z.array(PlanEvidenceZodModel),
});

export type PlanEvidence = z.infer<typeof PlanEvidenceZodModel>;
export type BuildStrategyRecommendation = z.infer<typeof BuildStrategyRecommendationZodModel>;
export type PlanQuestion = z.infer<typeof PlanQuestionZodModel>;
export type PlanWarning = z.infer<typeof PlanWarningZodModel>;
export type AgentLaunchPlan = z.infer<typeof AgentLaunchPlanZodModel>;
export type AgentLaunchPlanRequest = z.infer<typeof AgentLaunchPlanRequestZodModel>;
