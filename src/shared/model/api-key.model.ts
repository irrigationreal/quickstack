import { z } from "zod";

export const apiKeyScopeZodModel = z.enum(['apps:read', 'apps:write', 'build:write', 'deploy:write']);
export type ApiKeyScope = z.infer<typeof apiKeyScopeZodModel>;

export const apiKeyCreateZodModel = z.object({
    name: z.string().trim().min(1, 'API key name is required.').max(100),
    scopes: z.array(apiKeyScopeZodModel).min(1).default(['apps:read', 'apps:write', 'build:write', 'deploy:write']),
    appIds: z.array(z.string().min(1)).optional(),
    projectIds: z.array(z.string().min(1)).optional(),
    expiresAt: z.date().nullish(),
});

export type ApiKeyCreateModel = z.infer<typeof apiKeyCreateZodModel>;

export type ApiKeyListItemModel = {
    id: string;
    name: string;
    prefix: string;
    scopes: ApiKeyScope[];
    appIds: string[];
    projectIds: string[];
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
};

export type ApiKeyCreateResultModel = {
    apiKey: ApiKeyListItemModel;
    plaintextKey: string;
};
