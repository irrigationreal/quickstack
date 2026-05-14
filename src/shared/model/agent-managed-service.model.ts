import { z } from "zod";

export const ManagedServiceFamilyZodModel = z.enum(['postgres', 'redis', 'mysql']);
export const ManagedServiceStatusZodModel = z.enum(['provisioning', 'healthy', 'degraded', 'failed']);

export const ManagedServiceZodModel = z.object({
    id: z.string(),
    family: ManagedServiceFamilyZodModel,
    name: z.string(),
    projectId: z.string(),
    status: ManagedServiceStatusZodModel,
    connection: z.object({
        hostname: z.string(),
        port: z.number().int(),
        databaseName: z.string().optional(),
        secretRefs: z.array(z.string()).optional(),
        proxyHint: z.string().optional(),
    }),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});

export const ManagedServiceListResponseZodModel = z.object({
    status: z.literal('success'),
    projectId: z.string(),
    services: z.array(ManagedServiceZodModel),
});

export const ManagedServiceMutationResponseZodModel = z.object({
    status: z.literal('success'),
    service: ManagedServiceZodModel.optional(),
});

export type ManagedServiceFamily = z.infer<typeof ManagedServiceFamilyZodModel>;
export type ManagedService = z.infer<typeof ManagedServiceZodModel>;
export type ManagedServiceListResponse = z.infer<typeof ManagedServiceListResponseZodModel>;
export type ManagedServiceMutationResponse = z.infer<typeof ManagedServiceMutationResponseZodModel>;
