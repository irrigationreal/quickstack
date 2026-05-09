import * as z from "zod"


export const PublicEndpointReservationModel = z.object({
  id: z.string(),
  publicIp: z.string(),
  publicPort: z.number().int(),
  protocol: z.string(),
  ownerType: z.string(),
  ownerId: z.string().nullish(),
  name: z.string().nullish(),
  notes: z.string().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
