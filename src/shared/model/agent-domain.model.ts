import { z } from "zod";

export const CertStateZodModel = z.object({
    status: z.enum(["pending", "issued", "failed"]),
    issuer: z.string().optional(),
    expiresAt: z.string().optional(),
    message: z.string().optional(),
});

export const DomainZodModel = z.object({
    id: z.string(),
    hostname: z.string(),
    isPrimary: z.boolean(),
    certState: CertStateZodModel,
});

export type CertState = z.infer<typeof CertStateZodModel>;
export type Domain = z.infer<typeof DomainZodModel>;
