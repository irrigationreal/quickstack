import appService from "./app.service";
import apiKeyService, { AuthenticatedApiKey } from "./api-key.service";
import { REGISTRY_TOKEN_SERVICE } from "./registry-auth-config";
import registryService from "./registry.service";
import registryTokenSigningService from "./registry-token-signing.service";
import { assertSessionCanWriteApp } from "../utils/action-wrapper.utils";
import { ServiceException } from "@/shared/model/service.exception.model";

const TOKEN_TTL_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 30;
const REGISTRY_ACTIONS = ['pull', 'push'] as const;

type RegistryAction = typeof REGISTRY_ACTIONS[number];

type RegistryScope = {
    type: 'repository';
    name: string;
    actions: RegistryAction[];
};

function decodeBasicAuthorization(header: string | null) {
    if (!header?.startsWith('Basic ')) {
        throw new ServiceException('Docker registry token requests must use Basic authentication with the API key as the password.');
    }
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex < 0) {
        throw new ServiceException('Docker registry Basic authentication is malformed.');
    }
    return { username: decoded.slice(0, colonIndex), password: decoded.slice(colonIndex + 1) };
}

function parseScope(value: string): RegistryScope {
    const [type, name, actions] = value.split(':');
    if (type !== 'repository' || !name || !actions) {
        throw new ServiceException('Registry token scope must be repository:<name>:<actions>.');
    }
    if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(name)) {
        throw new ServiceException('Registry repository scope is malformed.');
    }
    const requestedActions = actions.split(',').filter((action): action is RegistryAction => REGISTRY_ACTIONS.includes(action as RegistryAction));
    if (requestedActions.length === 0) {
        throw new ServiceException('Registry token scope does not request any supported action.');
    }
    return { type: 'repository', name, actions: Array.from(new Set(requestedActions)) };
}

class RegistryAuthService {
    async ensurePublicCertificate() {
        return await registryTokenSigningService.publicCertPem();
    }

    async authenticateDockerBasic(header: string | null): Promise<AuthenticatedApiKey> {
        const basic = decodeBasicAuthorization(header);
        const apiKey = basic.password || basic.username;
        return await apiKeyService.authenticateAuthorizationHeader(`Bearer ${apiKey}`);
    }

    async issueToken(input: { authorization: string | null; service: string | null; scopes: string[] }) {
        const issuer = await registryService.getTokenIssuer();
        const expectedService = REGISTRY_TOKEN_SERVICE;
        if (input.service !== expectedService) {
            throw new ServiceException('Registry token service does not match this QuickStack registry.');
        }
        const authenticated = await this.authenticateDockerBasic(input.authorization);
        if (!apiKeyService.hasScope(authenticated.apiKey, 'build:write')) {
            throw new ServiceException('API key does not have build permission.');
        }

        const access = [] as Array<{ type: 'repository'; name: string; actions: RegistryAction[] }>;
        for (const rawScope of input.scopes) {
            const scope = parseScope(rawScope);
            const appId = scope.name;
            const app = await appService.getById(appId).catch(() => null);
            if (!app || registryService.repositoryForApp(app.id) !== scope.name) {
                throw new ServiceException('Registry token scope does not match a QuickStack app repository.');
            }
            if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
                throw new ServiceException(apiKeyService.appScopeDenialMessage(app));
            }
            try {
                assertSessionCanWriteApp(authenticated.session, app.id);
            } catch {
                throw new ServiceException('API key user cannot write this app.');
            }
            access.push({ type: scope.type, name: scope.name, actions: scope.actions });
        }

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iss: issuer,
            sub: authenticated.apiKey.id,
            aud: expectedService,
            iat: now,
            nbf: now - CLOCK_SKEW_SECONDS,
            exp: now + TOKEN_TTL_SECONDS,
            access,
        };
        const token = await registryTokenSigningService.signRs256(payload);
        return {
            token,
            access_token: token,
            expires_in: TOKEN_TTL_SECONDS,
            issued_at: new Date(now * 1000).toISOString(),
        };
    }
}

const registryAuthService = new RegistryAuthService();
export default registryAuthService;
