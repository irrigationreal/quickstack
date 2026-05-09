vi.mock('next/cache', () => ({
    revalidateTag: vi.fn(),
    unstable_cache: vi.fn().mockImplementation(
        (fn: (...args: unknown[]) => Promise<unknown>) =>
            (...args: unknown[]) =>
                fn(...args)
    ),
}));

const sessionMocks = vi.hoisted(() => ({
    getAdminUserSession: vi.fn(),
}));

const paramMocks = vi.hoisted(() => ({
    getString: vi.fn(),
    save: vi.fn(),
    deleteByNameIfExists: vi.fn(),
}));

const runtimeClassMocks = vi.hoisted(() => ({
    assertRuntimeClassHealthy: vi.fn(),
    getRuntimeClasses: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({
    recordBestEffort: vi.fn(),
}));

vi.mock('@/server/utils/action-wrapper.utils', () => ({
    getAdminUserSession: sessionMocks.getAdminUserSession,
    getAuthUserSession: vi.fn(),
    saveFormAction: vi.fn(async (inputData: unknown, zodModel: any, handler: any) => {
        const validated = zodModel.safeParse(inputData);
        if (!validated.success) {
            throw validated.error;
        }
        await handler(validated.data);
    }),
    simpleAction: vi.fn(async (handler: any) => handler()),
    fileUploadAction: vi.fn(),
}));

vi.mock('@/server/services/param.service', () => ({
    default: paramMocks,
    ParamService: {
        DEFAULT_APP_RUNTIME_CLASS: 'defaultAppRuntimeClass',
    },
}));

vi.mock('@/server/services/runtime-class.service', () => ({ default: runtimeClassMocks }));
vi.mock('@/server/services/audit.service', () => ({
    default: auditMocks,
    auditActorFromSession: vi.fn((session) => ({ actorType: 'USER', actorUserId: session.userId, actorEmail: session.email })),
}));
vi.mock('@/server/services/security-quota.service', () => ({ default: {} }));
vi.mock('@/server/services/qs.service', () => ({ default: {} }));
vi.mock('@/server/services/registry.service', () => ({ default: {} }));
vi.mock('@/server/services/build.service', () => ({ default: {} }));
vi.mock('@/server/services/standalone-services/standalone-pod.service', () => ({ default: {} }));
vi.mock('@/server/services/standalone-services/maintenance.service', () => ({ default: {} }));
vi.mock('@/server/services/standalone-services/app-logs.service', () => ({ default: {} }));
vi.mock('@/server/services/standalone-services/system-backup.service', () => ({ default: {} }));
vi.mock('@/server/services/standalone-services/backup.service', () => ({ default: {} }));
vi.mock('@/server/services/network-policy.service', () => ({ default: {} }));
vi.mock('@/server/services/traefik.service', () => ({ default: {} }));
vi.mock('@/server/services/cluster.service', () => ({ default: {} }));
vi.mock('@/server/services/upgrade-services/k3s-update.service', () => ({ default: {} }));
vi.mock('@/server/services/upgrade-services/longhorn-update.service', () => ({ default: {} }));
vi.mock('@/server/services/longhorn-ui.service', () => ({ default: {} }));
vi.mock('@/server/adapter/ip-adress-finder.adapter', () => ({ default: {} }));
vi.mock('@/server/utils/path.utils', () => ({ PathUtils: {} }));
vi.mock('@/server/utils/fs.utils', () => ({ FsUtils: {} }));

import { ServiceException } from '@/shared/model/service.exception.model';
import { getRuntimeClassSettings, saveRuntimeClassSettings } from './actions';

describe('server settings RuntimeClass actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionMocks.getAdminUserSession.mockResolvedValue({ userId: 'user-1', email: 'admin@example.com' });
        runtimeClassMocks.assertRuntimeClassHealthy.mockResolvedValue({ runtimeClassName: 'kata', healthy: true, checkedAt: new Date(), nodeName: 'node-1', runtimeProof: 'kata', message: 'ok', nodes: [{ nodeName: 'node-1', healthy: true, runtimeProof: 'kata', podPhase: 'Running', message: 'ok' }] });
        runtimeClassMocks.getRuntimeClasses.mockResolvedValue([{ name: 'kata', handler: 'kata', hasScheduling: false, hasOverhead: false }]);
        paramMocks.getString.mockResolvedValue(undefined);
    });

    it('preflights and saves an available default app RuntimeClass', async () => {
        await saveRuntimeClassSettings({}, { defaultAppRuntimeClass: ' kata ' });

        expect(runtimeClassMocks.assertRuntimeClassHealthy).toHaveBeenCalledWith('kata');
        expect(paramMocks.save).toHaveBeenCalledWith({ name: 'defaultAppRuntimeClass', value: 'kata' });
        expect(auditMocks.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SECURITY_RUNTIME_CLASS_UPDATE',
            outcome: 'SUCCESS',
            metadata: expect.objectContaining({ defaultAppRuntimeClass: 'kata' }),
        }));
    });

    it('does not save an unavailable default app RuntimeClass', async () => {
        runtimeClassMocks.assertRuntimeClassHealthy.mockRejectedValue(new ServiceException('RuntimeClass "missing" is not available in this cluster.'));

        await expect(saveRuntimeClassSettings({}, { defaultAppRuntimeClass: 'missing' }))
            .rejects.toThrow('RuntimeClass "missing" is not available');

        expect(paramMocks.save).not.toHaveBeenCalled();
        expect(paramMocks.deleteByNameIfExists).not.toHaveBeenCalled();
    });

    it('returns the configured default and discovered RuntimeClasses', async () => {
        paramMocks.getString.mockResolvedValue('kata');

        const settings = await getRuntimeClassSettings();

        expect(settings).toEqual({
            defaultAppRuntimeClass: 'kata',
            runtimeClasses: [{ name: 'kata', handler: 'kata', hasScheduling: false, hasOverhead: false }],
        });
    });
});
