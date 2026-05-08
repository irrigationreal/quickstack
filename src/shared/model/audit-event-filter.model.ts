import { z } from "zod";

export const auditEventFilterZodModel = z.object({
    actorEmail: z.string().optional(),
    action: z.string().optional(),
    outcome: z.string().optional(),
    projectId: z.string().optional(),
    appId: z.string().optional(),
    deploymentId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});

export type AuditEventFilterModel = z.infer<typeof auditEventFilterZodModel>;
