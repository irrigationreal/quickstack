import { z } from "zod";

export const AgentVolumeZodModel = z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    storageClass: z.string(),
    mountPath: z.string(),
    accessMode: z.string(),
    attachedPods: z.array(z.string()),
    used: z.number().optional(),
    free: z.number().optional(),
});

export const StorageStateZodModel = z.object({
    volumes: AgentVolumeZodModel.array(),
    totalSize: z.number(),
    totalUsed: z.number().optional(),
    snapshots: z.array(z.object({ id: z.string(), volumeId: z.string(), createdAt: z.string().optional() })).optional(),
});

export type AgentVolume = z.infer<typeof AgentVolumeZodModel>;
export type StorageState = z.infer<typeof StorageStateZodModel>;
