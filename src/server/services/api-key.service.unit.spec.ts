const dbMocks = vi.hoisted(() => ({
    apiKeyCreate: vi.fn(),
    apiKeyFindMany: vi.fn(),
    apiKeyFindUnique: vi.fn(),
    apiKeyUpdate: vi.fn(),
}));

const userGroupMocks = vi.hoisted(() => ({
    getRoleByUserMail: vi.fn(),
}));

vi.mock('@/server/adapter/db.client', () => ({
    default: {
        client: {
            apiKey: {
                create: dbMocks.apiKeyCreate,
                findMany: dbMocks.apiKeyFindMany,
                findUnique: dbMocks.apiKeyFindUnique,
                update: dbMocks.apiKeyUpdate,
            },
        },
    },
}));

vi.mock('@/server/services/user-group.service', () => ({
    default: {
        getRoleByUserMail: userGroupMocks.getRoleByUserMail,
    },
}));

import apiKeyService from './api-key.service';

describe('api-key.service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        userGroupMocks.getRoleByUserMail.mockResolvedValue({
            id: 'group-1',
            name: 'admin',
            canAccessBackups: true,
            roleProjectPermissions: [],
        });
        dbMocks.apiKeyUpdate.mockResolvedValue({});
    });

    it('returns plaintext once and stores only the hash when creating a key', async () => {
        dbMocks.apiKeyCreate.mockImplementation(async ({ data }) => ({
            id: 'key-1',
            createdAt: new Date('2026-05-08T00:00:00Z'),
            updatedAt: new Date('2026-05-08T00:00:00Z'),
            lastUsedAt: null,
            revokedAt: null,
            ...data,
        }));

        const result = await apiKeyService.createForUser('user-1', {
            name: 'Claude agent',
            scopes: ['apps:read', 'deploy:write'],
            appIds: [],
            projectIds: [],
            expiresAt: null,
        });

        expect(result.plaintextKey).toMatch(/^qstk_[a-f0-9]{12}_/);
        const createData = dbMocks.apiKeyCreate.mock.calls[0][0].data;
        expect(createData.keyHash).toBe(apiKeyService.hashForTest(result.plaintextKey));
        expect(JSON.stringify(createData)).not.toContain(result.plaintextKey);
    });

    it('authenticates a valid bearer key and returns an API_KEY audit actor', async () => {
        const plaintextKey = 'qstk_abcdef123456_secret';
        const keyHash = apiKeyService.hashForTest(plaintextKey);
        dbMocks.apiKeyFindUnique.mockResolvedValue({
            id: 'key-1',
            userId: 'user-1',
            name: 'Claude agent',
            prefix: 'abcdef123456',
            keyHash,
            scopes: JSON.stringify(['apps:read', 'deploy:write']),
            appIdsJson: null,
            projectIdsJson: null,
            lastUsedAt: null,
            revokedAt: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            user: {
                id: 'user-1',
                email: 'admin@example.com',
            },
        });

        const authenticated = await apiKeyService.authenticateAuthorizationHeader(`Bearer ${plaintextKey}`);

        expect(authenticated.session.email).toBe('admin@example.com');
        expect(authenticated.auditActor).toMatchObject({
            actorType: 'API_KEY',
            actorUserId: 'user-1',
            actorEmail: 'admin@example.com',
            apiKeyId: 'key-1',
            apiKeyName: 'Claude agent',
        });
        expect(dbMocks.apiKeyUpdate).toHaveBeenCalledWith({
            where: { id: 'key-1' },
            data: { lastUsedAt: expect.any(Date) },
        });
    });

    it('rejects revoked keys', async () => {
        const plaintextKey = 'qstk_abcdef123456_secret';
        dbMocks.apiKeyFindUnique.mockResolvedValue({
            keyHash: apiKeyService.hashForTest(plaintextKey),
            revokedAt: new Date(),
        });

        await expect(apiKeyService.authenticateAuthorizationHeader(`Bearer ${plaintextKey}`)).rejects.toThrow('revoked');
    });
});
