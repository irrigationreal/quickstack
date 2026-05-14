const appMocks = vi.hoisted(() => ({ getById: vi.fn(), getExtendedById: vi.fn() }));
const secretMocks = vi.hoisted(() => ({ decryptForKubernetes: vi.fn(), deleteMany: vi.fn(), upsertMany: vi.fn() }));
const managedMocks = vi.hoisted(() => ({ attachPostgres: vi.fn(), attachRedis: vi.fn(), attachMysql: vi.fn() }));
const dataMocks = vi.hoisted(() => ({ client: { app: { findMany: vi.fn() } } }));

vi.mock('./app.service', () => ({ default: appMocks }));
vi.mock('./app-secret-env.service', () => ({ default: secretMocks }));
vi.mock('./quickstack-managed-service', () => ({ default: managedMocks }));
vi.mock('../adapter/db.client', () => ({ default: dataMocks }));

import serviceAttachmentService from './service-attachment.service';

const actor = { actorType: 'API_KEY' as const, actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'agent' };

function appWithSecret(value = 'postgresql://user:pass@svc-pg-1:5432/appdb') {
    return {
        id: 'app-1',
        projectId: 'proj-1',
        appSecretEnvVars: [{ name: 'DATABASE_URL', encryptedValue: 'encrypted', createdAt: new Date('2026-01-01T00:00:00Z') }],
    };
}

function postgresService(id = 'pg-1') {
    return {
        id,
        name: 'Postgres',
        projectId: 'proj-1',
        appType: 'POSTGRES',
        envVars: 'POSTGRES_DB=appdb\nPOSTGRES_USER=user\nPOSTGRES_PASSWORD=pass\n',
        appPorts: [{ port: 5432 }],
    };
}

describe('serviceAttachmentService.listForApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dataMocks.client.app.findMany.mockResolvedValue([{ id: 'pg-1' }]);
        secretMocks.decryptForKubernetes.mockReturnValue('postgresql://user:pass@svc-pg-1:5432/appdb');
    });

    it('reflects custom-named secrets when the connection points at a managed service', async () => {
        appMocks.getExtendedById.mockImplementation((id: string) => id === 'pg-1'
            ? Promise.resolve(postgresService())
            : Promise.resolve({ ...appWithSecret(), appSecretEnvVars: [{ name: 'CUSTOM_DATABASE_URL', encryptedValue: 'encrypted', createdAt: new Date('2026-01-01T00:00:00Z') }] }));

        const attachments = await serviceAttachmentService.listForApp('app-1');

        expect(attachments).toEqual([expect.objectContaining({ serviceId: 'pg-1', family: 'postgres', injectedSecretKeys: ['CUSTOM_DATABASE_URL'] })]);
    });
});

describe('serviceAttachmentService.detach', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        secretMocks.decryptForKubernetes.mockReturnValue('postgresql://user:pass@svc-pg-1:5432/appdb');
    });

    it('does not delete DATABASE_URL when the service id is invalid', async () => {
        appMocks.getExtendedById.mockImplementation((id: string) => id === 'missing-service' ? Promise.reject(new Error('not found')) : Promise.resolve(appWithSecret()));

        await expect(serviceAttachmentService.detach({ appId: 'app-1', serviceId: 'missing-service', actor })).rejects.toThrow('Managed service was not found');
        expect(secretMocks.deleteMany).not.toHaveBeenCalled();
    });

    it('only detaches the secret when it points at the requested managed service', async () => {
        appMocks.getExtendedById.mockImplementation((id: string) => id === 'pg-1' ? Promise.resolve(postgresService()) : Promise.resolve(appWithSecret()));
        secretMocks.decryptForKubernetes.mockReturnValue('postgresql://user:pass@svc-other:5432/appdb');

        const result = await serviceAttachmentService.detach({ appId: 'app-1', serviceId: 'pg-1', actor });

        expect(result.detached).toBe(false);
        expect(secretMocks.deleteMany).not.toHaveBeenCalled();
    });
});
