import { stringToOptionalNumber } from "@/shared/utils/zod.utils";
import { z } from "zod";

const runtimeClassNamePattern = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export function normalizeRuntimeClassName(value?: string | null) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export const runtimeClassNameZodModel = z.string()
  .max(253, 'RuntimeClass name must be 253 characters or less.')
  .refine((value) => {
    const normalized = normalizeRuntimeClassName(value);
    return !normalized || runtimeClassNamePattern.test(normalized);
  }, 'RuntimeClass name must use lowercase letters, numbers, dashes, and dots, and must start and end with a letter or number.')
  .nullish();

export const appContainerConfigZodModel = z.object({
  containerCommand: z.string().trim().nullish(),
  containerArgs: z.array(z.object({
    value: z.string().trim()
  })).optional(),
  runtimeClassName: runtimeClassNameZodModel,
  securityContextRunAsUser: stringToOptionalNumber,
  securityContextRunAsGroup: stringToOptionalNumber,
  securityContextFsGroup: stringToOptionalNumber,
  securityContextPrivileged: z.boolean().default(false),
});

export type AppContainerConfigModel = z.infer<typeof appContainerConfigZodModel>;