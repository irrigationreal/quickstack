import { z } from "zod";
import { ManagedServiceFamilyZodModel } from "./agent-managed-service.model";

export const ServiceAttachmentZodModel = z.object({
    serviceId: z.string(),
    family: ManagedServiceFamilyZodModel,
    appId: z.string(),
    attachedAt: z.string(),
    injectedEnvKeys: z.array(z.string()),
    injectedSecretKeys: z.array(z.string()),
});

export type ServiceAttachment = z.infer<typeof ServiceAttachmentZodModel>;
