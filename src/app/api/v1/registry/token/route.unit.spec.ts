const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
    appScopeDenialMessage: vi.fn(),
}));
const registryMocks = vi.hoisted(() => ({ getTokenIssuer: vi.fn(), repositoryForApp: vi.fn() }));
const signingMocks = vi.hoisted(() => ({ signRs256: vi.fn(), publicJwksJson: vi.fn() }));
const authWrapperMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/registry.service', () => ({ default: registryMocks }));
vi.mock('@/server/services/registry-token-signing.service', () => ({ default: signingMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authWrapperMocks);

import { GET } from './route';

function basic(password: string, username = 'quickstack') {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe('registry token route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registryMocks.getTokenIssuer.mockResolvedValue('quickstack-registry');
        registryMocks.repositoryForApp.mockImplementation((appId: string) => appId);
        signingMocks.signRs256.mockResolvedValue('signed.registry.jwt');
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo' });
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({
            session: { id: 'user-1', email: 'user@example.com' },
            apiKey: { id: 'key-1' },
            auditActor: { actorType: 'API_KEY' },
        });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        apiKeyMocks.appScopeDenialMessage.mockReturnValue('denied');
    });

    it('exchanges a Docker Basic auth API key for a scoped registry token', async () => {
        const response = await GET(new Request('https://quickstack.example.com/api/v1/registry/token?service=quickstack-registry&scope=repository:app-1:pull,push', {
            headers: { authorization: basic('qstk_prefix_secret') },
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(apiKeyMocks.authenticateAuthorizationHeader).toHaveBeenCalledWith('Bearer qstk_prefix_secret');
        expect(signingMocks.signRs256).toHaveBeenCalledWith(expect.objectContaining({
            aud: 'quickstack-registry',
            iss: 'quickstack-registry',
            sub: 'key-1',
            access: [{ type: 'repository', name: 'app-1', actions: ['pull', 'push'] }],
        }));
        expect(body.token).toBe('signed.registry.jwt');
        expect(body.access_token).toBe('signed.registry.jwt');
    });

    it('rejects a repository outside the API key app scope', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);
        const response = await GET(new Request('https://quickstack.example.com/api/v1/registry/token?service=quickstack-registry&scope=repository:app-1:pull,push', {
            headers: { authorization: basic('qstk_prefix_secret') },
        }));
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.message).toBe('denied');
        expect(signingMocks.signRs256).not.toHaveBeenCalled();
    });

    it('rejects the wrong registry service audience', async () => {
        const response = await GET(new Request('https://quickstack.example.com/api/v1/registry/token?service=other-registry&scope=repository:app-1:pull,push', {
            headers: { authorization: basic('qstk_prefix_secret') },
        }));

        expect(response.status).toBe(403);
        expect(apiKeyMocks.authenticateAuthorizationHeader).not.toHaveBeenCalled();
    });
});
