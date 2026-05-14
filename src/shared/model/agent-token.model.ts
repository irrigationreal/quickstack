import { z } from "zod";

export const TokenScopeZodModel = z.union([
    z.literal('actor'),
    z.object({ project: z.string() }),
    z.object({ app: z.string() }),
]);

export const AgentTokenZodModel = z.object({
    id: z.string(),
    scope: TokenScopeZodModel,
    prefix: z.string(),
    issuedAt: z.string(),
    lastUsedAt: z.string().optional(),
    issuedByActorId: z.string(),
    expiresAt: z.string().optional(),
    revokedAt: z.string().optional(),
});

export type TokenScope = z.infer<typeof TokenScopeZodModel>;
export type AgentToken = z.infer<typeof AgentTokenZodModel>;
