import crypto from "crypto";
import { ApiKey } from "@prisma/client";
import dataAccess from "../adapter/db.client";
import userGroupService from "./user-group.service";
import { ServiceException } from "@/shared/model/service.exception.model";
import { ApiKeyCreateModel, ApiKeyCreateResultModel, ApiKeyListItemModel, ApiKeyScope, apiKeyCreateZodModel } from "@/shared/model/api-key.model";
import { AuditActor } from "./audit.service";
import { UserSession } from "@/shared/model/sim-session.model";
import type { TokenScope } from "@/shared/model/agent-token.model";

const API_KEY_PREFIX = 'qstk';
const KEY_RANDOM_BYTES = 32;

export type AuthenticatedApiKey = {
    session: UserSession;
    apiKey: ApiKey;
    auditActor: AuditActor;
};

export type ApiKeyAuthenticationOptions = {
    allowInactive?: boolean;
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

function scopeFromApiKey(apiKey: ApiKey): TokenScope {
    const appIds = parseJsonList(apiKey.appIdsJson);
    const projectIds = parseJsonList(apiKey.projectIdsJson);
    if (appIds[0]) return { app: appIds[0] };
    if (projectIds[0]) return { project: projectIds[0] };
    return 'actor';
}

function mapAgentToken(apiKey: ApiKey) {
    return {
        id: apiKey.id,
        scope: scopeFromApiKey(apiKey),
        prefix: `${API_KEY_PREFIX}_${apiKey.prefix}_…`,
        issuedAt: apiKey.createdAt instanceof Date ? apiKey.createdAt.toISOString() : String(apiKey.createdAt),
        lastUsedAt: apiKey.lastUsedAt ? apiKey.lastUsedAt.toISOString() : undefined,
        issuedByActorId: apiKey.userId,
        expiresAt: apiKey.expiresAt ? apiKey.expiresAt.toISOString() : undefined,
        revokedAt: apiKey.revokedAt ? apiKey.revokedAt.toISOString() : undefined,
    };
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

    scopeForToken(apiKey: ApiKey): TokenScope {
        return scopeFromApiKey(apiKey);
    }

    async issueToken(actor: { actorUserId?: string | null }, scope: TokenScope) {
        if (!actor.actorUserId) {
            throw new ServiceException('Authenticated actor is required to issue a token.');
        }
        const appIds = typeof scope === 'object' && 'app' in scope ? [scope.app] : undefined;
        const projectIds = typeof scope === 'object' && 'project' in scope ? [scope.project] : undefined;
        const result = await this.createForUser(actor.actorUserId, {
            name: `quickstack-cli-${Date.now()}`,
            scopes: ['apps:read', 'apps:write', 'build:write', 'deploy:write'],
            appIds,
            projectIds,
        });
        const created = await dataAccess.client.apiKey.findUniqueOrThrow({ where: { id: result.apiKey.id } });
        return { token: mapAgentToken(created), plaintextToken: result.plaintextKey };
    }

    private async tokenWithinCurrentScope(currentApiKey: ApiKey | undefined, token: ApiKey) {
        if (!currentApiKey) return true;
        const currentScope = this.scopeForToken(currentApiKey);
        const tokenScope = this.scopeForToken(token);
        if (currentScope === 'actor') return true;
        if (tokenScope === 'actor') return false;
        if ('project' in currentScope) {
            if ('project' in tokenScope) return tokenScope.project === currentScope.project;
            const app = 'app' in tokenScope ? await dataAccess.client.app.findUnique({ where: { id: tokenScope.app }, select: { projectId: true } }) : null;
            return app?.projectId === currentScope.project;
        }
        return 'app' in tokenScope && tokenScope.app === currentScope.app;
    }

    async listTokens(actor: { actorUserId?: string | null }, currentApiKey?: ApiKey) {
        if (!actor.actorUserId) {
            throw new ServiceException('Authenticated actor is required to list tokens.');
        }
        const apiKeys = await dataAccess.client.apiKey.findMany({ where: { userId: actor.actorUserId, name: { startsWith: 'quickstack-cli-' } }, orderBy: { createdAt: 'desc' } });
        const visible = [];
        for (const apiKey of apiKeys) {
            if (await this.tokenWithinCurrentScope(currentApiKey, apiKey)) visible.push(apiKey);
        }
        return visible.map(mapAgentToken);
    }

    async revokeToken(actor: { actorUserId?: string | null }, tokenId: string, currentApiKey?: ApiKey) {
        if (!actor.actorUserId) {
            throw new ServiceException('Authenticated actor is required to revoke a token.');
        }
        const token = await dataAccess.client.apiKey.findFirst({ where: { id: tokenId, userId: actor.actorUserId, name: { startsWith: 'quickstack-cli-' } } });
        if (!token) throw new ServiceException('Token was not found or is not owned by this actor.');
        if (!await this.tokenWithinCurrentScope(currentApiKey, token)) throw new ServiceException('Current token is not allowed to revoke a wider-scoped token.');
        const revoked = await dataAccess.client.apiKey.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
        return mapAgentToken(revoked);
    }

    async canIssueScope(apiKey: ApiKey, requestedScope: TokenScope) {
        const currentAppIds = parseJsonList(apiKey.appIdsJson);
        const currentProjectIds = parseJsonList(apiKey.projectIdsJson);
        const issuerIsActorScoped = currentAppIds.length === 0 && currentProjectIds.length === 0;
        if (requestedScope === 'actor') {
            return issuerIsActorScoped;
        }
        if ('project' in requestedScope) {
            return currentAppIds.length === 0 && (currentProjectIds.length === 0 || currentProjectIds.includes(requestedScope.project));
        }
        if (currentAppIds.length > 0 && !currentAppIds.includes(requestedScope.app)) {
            return false;
        }
        const app = await dataAccess.client.app.findUnique({ where: { id: requestedScope.app }, select: { projectId: true } });
        if (!app) {
            return false;
        }
        return currentProjectIds.length === 0 || currentProjectIds.includes(app.projectId);
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

    async authenticateAuthorizationHeader(header: string | null, options: ApiKeyAuthenticationOptions = {}): Promise<AuthenticatedApiKey> {
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
        if (!options.allowInactive && apiKey.revokedAt) {
            throw new ServiceException(`API key has been revoked at ${apiKey.revokedAt.toISOString()}.`);
        }
        if (!options.allowInactive && apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
            throw new ServiceException(`API key expired at ${apiKey.expiresAt.toISOString()}.`);
        }

        const userGroup = await userGroupService.getRoleByUserMail(apiKey.user.email);
        const session: UserSession = {
            id: apiKey.user.id,
            email: apiKey.user.email,
            userGroup: userGroup ?? undefined,
        };

        if (!apiKey.revokedAt && (!apiKey.expiresAt || apiKey.expiresAt.getTime() > Date.now())) {
            await dataAccess.client.apiKey.update({
                where: { id: apiKey.id },
                data: { lastUsedAt: new Date() },
            });
        }

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

    appScopeDenial(apiKey: ApiKey, app: { id: string; name?: string | null; projectId: string }) {
        return {
            scope: this.scopeForToken(apiKey),
            ownership: { appId: app.id, appName: app.name, projectId: app.projectId },
            remediation: 'Re-issue with a wider scope or use a different token.',
        };
    }

    appScopeDenialMessage(app: { id: string; projectId: string }) {
        return `App ${app.id} is in project ${app.projectId}, which is not included in this token's scope.`;
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
