import { z } from "zod";

export const BuildStrategyZodModel = z.enum(["source-tar", "local-docker", "existing-image", "remote-builder"]);

export const ImageRefZodModel = z.object({
    registry: z.string(),
    repository: z.string(),
    digest: z.string().optional(),
    tag: z.string().optional(),
});

export const BuildResultZodModel = z.object({
    image: ImageRefZodModel,
    imageReference: z.string(),
    strategy: BuildStrategyZodModel,
    sourceProvenance: z.string(),
    cacheHit: z.boolean().default(false),
    sizeBytes: z.number().int().positive().optional(),
    buildId: z.string().optional(),
});

export const BuildCapabilitiesZodModel = z.object({
    strategies: z.array(BuildStrategyZodModel),
    registry: z.object({
        url: z.string(),
        pushCredentials: z.boolean().optional(),
    }).optional(),
    remoteBuilder: z.boolean().default(false),
});

export const BuildCreateRequestZodModel = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("local-docker-finalize"), imageReference: z.string().min(1), sourceProvenance: z.string().default("local-docker"), buildSecrets: z.array(z.string()).default([]) }),
    z.object({ kind: z.literal("remote-builder"), sourceProvenance: z.string().default("remote-builder"), buildSecrets: z.array(z.string()).default([]) }),
]);

export type BuildStrategy = z.infer<typeof BuildStrategyZodModel>;
export type ImageRef = z.infer<typeof ImageRefZodModel>;
export type BuildResult = z.infer<typeof BuildResultZodModel>;
export type BuildCapabilities = z.infer<typeof BuildCapabilitiesZodModel>;
export type BuildCreateRequest = z.infer<typeof BuildCreateRequestZodModel>;
