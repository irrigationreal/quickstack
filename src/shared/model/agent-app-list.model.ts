import { z } from "zod";

export const AgentAppSummaryZodModel = z.object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    status: z.string(),
    lastDeployedAt: z.string().optional(),
});

export const AgentAppListZodModel = z.object({
    apps: AgentAppSummaryZodModel.array(),
});

export type AgentAppSummary = z.infer<typeof AgentAppSummaryZodModel>;
export type AgentAppListResponse = z.infer<typeof AgentAppListZodModel>;
