vi.mock('next/cache', () => ({
    revalidateTag: vi.fn(),
    unstable_cache: vi.fn().mockImplementation(
        (fn: (...args: unknown[]) => Promise<unknown>) =>
            (...args: unknown[]) =>
                fn(...args)
    ),
}));

const { createAuditEvent } = vi.hoisted(() => ({
    createAuditEvent: vi.fn(),
}));

vi.mock('@/server/adapter/db.client', () => ({
    default: {
        client: {
            auditEvent: {
                create: createAuditEvent,
                findMany: vi.fn(),
            },
            $queryRaw: vi.fn(),
        }
    }
}));

import auditService from './audit.service';

describe('audit.service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('NODE_ENV', 'test');
        createAuditEvent.mockResolvedValue({ id: 'audit-1' });
    });

    it('redacts secret-like metadata values before persisting an audit event', async () => {
        await auditService.record({
            actorType: 'USER',
            actorUserId: 'user-1',
            actorEmail: 'admin@example.com',
            action: 'APP_SOURCE_UPDATE',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: 'app-1',
            metadata: {
                gitToken: 'ghp_secret',
                containerRegistryPassword: 'registry-secret',
                nested: {
                    secretKey: 's3-secret',
                    safeCount: 2,
                },
            },
        });

        const metadataJson = createAuditEvent.mock.calls[0][0].data.metadataJson;
        expect(metadataJson).toContain('[REDACTED]');
        expect(metadataJson).toContain('safeCount');
        expect(metadataJson).not.toContain('ghp_secret');
        expect(metadataJson).not.toContain('registry-secret');
        expect(metadataJson).not.toContain('s3-secret');
    });
});
