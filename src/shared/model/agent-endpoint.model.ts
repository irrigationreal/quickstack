import { z } from "zod";

export const EndpointZodModel = z.object({
    id: z.string(),
    port: z.number().int(),
    protocol: z.enum(["tcp", "udp", "http", "https"]),
    visibility: z.enum(["public", "private"]),
    attachedDomainId: z.string().optional(),
    publicIp: z.string().optional(),
    publicPort: z.number().int().optional(),
    targetPort: z.number().int().optional(),
    status: z.string().optional(),
});

export type Endpoint = z.infer<typeof EndpointZodModel>;
