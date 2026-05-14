import { z } from "zod";
import { AgentActorZodModel } from "./agent-me.model";

export const DiagnosticCheckZodModel = z.object({
    check: z.string(),
    status: z.enum(["ok", "warning", "error"]),
    message: z.string(),
    remediation: z.string().optional(),
});

export const DoctorResponseZodModel = z.object({
    actor: AgentActorZodModel.optional(),
    server: z.object({ version: z.string() }),
    cli: z.object({ version: z.string().optional(), matchingBinaryAvailable: z.boolean() }),
    checks: DiagnosticCheckZodModel.array(),
});

export type DiagnosticCheck = z.infer<typeof DiagnosticCheckZodModel>;
export type DoctorResponse = z.infer<typeof DoctorResponseZodModel>;
