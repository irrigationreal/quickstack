import { z } from "zod";

export const podsInfoZodModel = z.object({
    podName: z.string(),
    containerName: z.string(),
    appId: z.string().optional(),
    projectId: z.string().optional(),
    uid: z.string().optional(),
    status: z.string().optional(),
});

export type PodsInfoModel = z.infer<typeof podsInfoZodModel>;


