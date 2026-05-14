import crypto from "crypto";
import { ApiKey } from "@prisma/client";
import dataAccess from "../adapter/db.client";
import userGroupService from "./user-group.service";
import { ServiceException } from "@/shared/model/service.exception.model";
import { ApiKeyCreateModel, ApiKeyCreateResultModel, ApiKeyListItemModel, ApiKeyScope, apiKeyCreateZodModel } from "@/shared/model/api-key.model";
import { AuditActor } from "./audit.service";
import { UserSession } from "@/shared/model/sim-session.model";

const API_KEY_PREFIX = 'qstk';
const KEY_RANDOM_BYTES = 32;

export type AuthenticatedApiKey = {
    session: UserSession;
    apiKey: ApiKey;
    auditActor: AuditActor;
};

function hashApiKey(plaintextKey: string) {
    return crypto.createHash('sha256').update(plaintextKey).digest('hex');
}

function timingSafeEqualString(left: string, right: string) {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseJsonList(value?: string | null): string[] {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function parseScopes(value: string): ApiKeyScope[] {
    return parseJsonList(value).filter((scope): scope is ApiKeyScope => scope === 'apps:read' || scope === 'apps:write' || scope === 'build:write' || scope === 'deploy:write');
}

function serializeList(value?: string[] | null) {
    return value && value.length > 0 ? JSON.stringify(Array.from(new Set(value))) : null;
}

function mapApiKey(apiKey: ApiKey): ApiKeyListItemModel {
    return {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        scopes: parseScopes(apiKey.scopes),
        appIds: parseJsonList(apiKey.appIdsJson),
        projectIds: parseJsonList(apiKey.projectIdsJson),
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
    };
}

class ApiKeyService {
    public hashForTest(plaintextKey: string) {
        return hashApiKey(plaintextKey);
    }

    async createForUser(userId: string, input: ApiKeyCreateModel): Promise<ApiKeyCreateResultModel> {
        const data = apiKeyCreateZodModel.parse(input);
        const prefix = crypto.randomBytes(6).toString('hex');
        const secret = crypto.randomBytes(KEY_RANDOM_BYTES).toString('base64url');
        const plaintextKey = `${API_KEY_PREFIX}_${prefix}_${secret}`;
        const keyHash = hashApiKey(plaintextKey);

        const apiKey = await dataAccess.client.apiKey.create({
            data: {
                userId,
                name: data.name,
                prefix,
                keyHash,
                scopes: JSON.stringify(data.scopes),
                appIdsJson: serializeList(data.appIds),
                projectIdsJson: serializeList(data.projectIds),
                expiresAt: data.expiresAt ?? null,
            }
        });

        return {
            apiKey: mapApiKey(apiKey),
            plaintextKey,
        };
    }

    async listForUser(userId: string): Promise<ApiKeyListItemModel[]> {
        const apiKeys = await dataAccess.client.apiKey.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
        return apiKeys.map(mapApiKey);
    }

    async revokeForUser(userId: string, apiKeyId: string): Promise<void> {
        await dataAccess.client.apiKey.update({
            where: { id: apiKeyId, userId },
            data: { revokedAt: new Date() },
        });
    }

    async authenticateAuthorizationHeader(header: string | null): Promise<AuthenticatedApiKey> {
        if (!header?.startsWith('Bearer ')) {
            throw new ServiceException('Missing or invalid API key.');
        }

        const plaintextKey = header.slice('Bearer '.length).trim();
        const [scheme, prefix] = plaintextKey.split('_');
        if (scheme !== API_KEY_PREFIX || !prefix) {
            throw new ServiceException('Missing or invalid API key.');
        }

        const keyHash = hashApiKey(plaintextKey);
        const apiKey = await dataAccess.client.apiKey.findUnique({
            where: { keyHash },
            include: { user: true },
        });

        if (!apiKey || !timingSafeEqualString(apiKey.keyHash, keyHash)) {
            throw new ServiceException('Missing or invalid API key.');
        }
        if (apiKey.revokedAt) {
            throw new ServiceException('API key has been revoked.');
        }
        if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
            throw new ServiceException('API key has expired.');
        }

        const userGroup = await userGroupService.getRoleByUserMail(apiKey.user.email);
        const session: UserSession = {
            id: apiKey.user.id,
            email: apiKey.user.email,
            userGroup: userGroup ?? undefined,
        };

        await dataAccess.client.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        });

        return {
            session,
            apiKey,
            auditActor: {
                actorType: 'API_KEY',
                actorUserId: apiKey.user.id,
                actorEmail: apiKey.user.email,
                actorGroupName: userGroup?.name ?? null,
                apiKeyId: apiKey.id,
                apiKeyName: apiKey.name,
            },
        };
    }

    hasScope(apiKey: ApiKey, scope: ApiKeyScope) {
        return parseScopes(apiKey.scopes).includes(scope);
    }

    isAllowedForProject(apiKey: ApiKey, projectId: string) {
        const projectIds = parseJsonList(apiKey.projectIdsJson);
        return projectIds.length === 0 || projectIds.includes(projectId);
    }

    isAllowedForApp(apiKey: ApiKey, app: { id: string; projectId: string }) {
        const appIds = parseJsonList(apiKey.appIdsJson);
        return (appIds.length === 0 || appIds.includes(app.id))
            && this.isAllowedForProject(apiKey, app.projectId);
    }

    filterAllowedProjects<T extends { id: string; apps?: { id: string; projectId: string }[] }>(apiKey: ApiKey, projects: T[]) {
        return projects
            .filter(project => this.isAllowedForProject(apiKey, project.id))
            .map(project => ({
                ...project,
                apps: project.apps?.filter(app => this.isAllowedForApp(apiKey, app)) ?? [],
            }));
    }
}

const apiKeyService = new ApiKeyService();
export default apiKeyService;
