import { z } from "zod";
import { AgentActorZodModel } from "./agent-me.model";

export const DiagnosticCheckZodModel = z.object({
    check: z.string(),
    status: z.enum(["ok", "warning", "error"]),
    message: z.string(),
    remediation: z.string().optional(),
    code: z.string().optional(),
});

export const DoctorResponseZodModel = z.object({
    actor: AgentActorZodModel.optional(),
    server: z.object({ version: z.string() }),
    cli: z.object({ version: z.string().optional(), matchingBinaryAvailable: z.boolean() }),
    checks: DiagnosticCheckZodModel.array(),
    token: z.object({ id: z.string(), scope: z.unknown(), expired: z.boolean(), revoked: z.boolean() }).optional(),
    quota: z.object({ apps: DiagnosticCheckZodModel.optional(), volumes: DiagnosticCheckZodModel.optional(), managedServices: DiagnosticCheckZodModel.optional() }).optional(),
});

export type DiagnosticCheck = z.infer<typeof DiagnosticCheckZodModel>;
export type DoctorResponse = z.infer<typeof DoctorResponseZodModel>;
