import { z } from "zod";

export const AgentActorZodModel = z.object({
    id: z.string(),
    kind: z.enum(["user", "agent"]),
    displayName: z.string(),
    email: z.string().optional(),
});

export const AgentProjectSummaryZodModel = z.object({
    id: z.string(),
    name: z.string(),
    ownerActorId: z.string().nullable(),
});

export const AgentMeZodModel = z.object({
    actor: AgentActorZodModel,
    projects: AgentProjectSummaryZodModel.array(),
});

export type AgentActor = z.infer<typeof AgentActorZodModel>;
export type AgentProjectSummary = z.infer<typeof AgentProjectSummaryZodModel>;
export type AgentMeResponse = z.infer<typeof AgentMeZodModel>;
