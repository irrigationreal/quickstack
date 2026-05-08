const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const secretMocks = vi.hoisted(() => ({
    listNames: vi.fn(),
    upsertMany: vi.fn(),
    deleteMany: vi.fn(),
}));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/app-secret-env.service', () => ({ default: secretMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));

import { GET, POST } from './route';

function request(body?: Record<string, unknown>) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/secrets', {
        method: body ? 'POST' : 'GET',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('agent app secret env route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
        auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo App' });
        secretMocks.listNames.mockResolvedValue([{ name: 'API_TOKEN', createdAt: new Date(), updatedAt: new Date() }]);
        secretMocks.upsertMany.mockResolvedValue([]);
        secretMocks.deleteMany.mockResolvedValue([]);
    });

    it('requires apps:write before mutating secrets', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await POST(request({ secrets: { API_TOKEN: 'secret-value' } }), { params: Promise.resolve({ appId: 'app-1' }) });

        expect(response.status).toBe(403);
        expect(secretMocks.upsertMany).not.toHaveBeenCalled();
        expect(auditMocks.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({
            action: 'AGENT_APP_SECRET_ENV_REQUESTED',
            outcome: 'DENIED',
            message: 'API key does not have apps:write scope.',
        }));
    });

    it('stores secret values without returning them', async () => {
        const response = await POST(request({ secrets: { API_TOKEN: 'secret-value' } }), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(secretMocks.upsertMany).toHaveBeenCalledWith(expect.objectContaining({
            app: expect.objectContaining({ id: 'app-1', projectId: 'proj-1' }),
            secrets: [{ name: 'API_TOKEN', value: 'secret-value' }],
            actor: authenticated.auditActor,
        }));
        expect(JSON.stringify(json)).not.toContain('secret-value');
        expect(json.secrets).toEqual([{ name: 'API_TOKEN', createdAt: expect.any(String), updatedAt: expect.any(String) }]);
    });

    it('lists secret names only', async () => {
        const response = await GET(request(), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(secretMocks.listNames).toHaveBeenCalledWith('app-1');
        expect(JSON.stringify(json)).not.toContain('encryptedValue');
        expect(json.secrets[0].name).toBe('API_TOKEN');
    });
});
