import { z } from "zod";

export const quickDeployModeZodModel = z.enum(['static', 'dockerfile', 'image']).default('image');

export const quickDeployEnsureAppZodModel = z.object({
    projectId: z.string().min(1),
    appId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(100),
    image: z.string().trim().min(1).max(500),
    registryUsername: z.string().trim().min(1).max(500).optional(),
    registryPassword: z.string().min(1).max(5000).optional(),
    port: z.number().int().min(1).max(65535).default(80),
    domainPrefix: z.string().trim().min(1).max(40).optional(),
    mode: quickDeployModeZodModel,
});

export type QuickDeployEnsureAppModel = z.infer<typeof quickDeployEnsureAppZodModel>;

export const quickDeployUploadModeZodModel = z.enum(['static', 'dockerfile']);

export const quickDeployUploadMetadataZodModel = z.object({
    projectId: z.string().min(1),
    mode: quickDeployUploadModeZodModel,
    contentHash: z.string().trim().regex(/^sha256:[a-f0-9]{64}$/i, 'contentHash must be a sha256 digest.'),
    uploadBytes: z.number().int().positive().optional(),
    dockerfilePath: z.string().trim().min(1).max(500).default('./Dockerfile'),
});

export type QuickDeployUploadMetadataModel = z.infer<typeof quickDeployUploadMetadataZodModel>;

export const quickDeploySecretEnvSetZodModel = z.object({
    secrets: z.record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Secret names must be valid environment variable names.'),
        z.string()
    ).default({}),
    unset: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).default([]),
});

export type QuickDeploySecretEnvSetModel = z.infer<typeof quickDeploySecretEnvSetZodModel>;

export type QuickDeployEnsureAppResultModel = {
    appId: string;
    projectId: string;
    name: string;
    image: string;
    port: number;
    hostname: string;
    url: string;
};
