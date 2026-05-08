vi.mock('next/cache', () => ({
    revalidateTag: vi.fn(),
    unstable_cache: vi.fn().mockImplementation(
        (fn: (...args: unknown[]) => Promise<unknown>) =>
            (...args: unknown[]) =>
                fn(...args)
    ),
}));

vi.mock('@/server/adapter/db.client', () => ({ default: { client: {} } }));
vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({ default: {} }));
vi.mock('@/server/services/deployment.service', () => ({ default: {} }));
vi.mock('@/server/services/build.service', () => ({ default: {} }));
vi.mock('@/server/services/ingress.service', () => ({ default: {} }));
vi.mock('@/server/services/pvc.service', () => ({ default: {} }));
vi.mock('@/server/services/svc.service', () => ({ default: {} }));
vi.mock('@/server/services/deployment-logs.service', () => ({ default: {}, dlog: vi.fn() }));
vi.mock('@/server/services/network-policy.service', () => ({ default: {} }));
vi.mock('@/server/services/audit.service', () => ({
    default: {
        recordRequired: vi.fn(),
        recordBestEffort: vi.fn(),
    },
}));
vi.mock('@/server/services/security-quota.service', () => ({
    default: {
        getEffectiveQuota: vi.fn(),
        reserveDeployQuota: vi.fn(),
        assertProjectCanCreateApp: vi.fn(),
        assertAppResourceLimits: vi.fn(),
    },
}));

import appService from './app.service';
import auditService from '@/server/services/audit.service';
import securityQuotaService from '@/server/services/security-quota.service';
import dataAccess from '@/server/adapter/db.client';
import buildService from '@/server/services/build.service';
import deploymentService from '@/server/services/deployment.service';
import deploymentLogService from '@/server/services/deployment-logs.service';
import { ServiceException } from '@/shared/model/service.exception.model';
import { AppExtendedModel } from '@/shared/model/app-extended.model';

describe('app.service', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects direct deploy before build work when deploy quota is exceeded', async () => {
        const app = createApp({ sourceType: 'CONTAINER' });
        vi.spyOn(appService, 'getExtendedById').mockResolvedValue(app);
        vi.mocked(auditService.recordRequired).mockResolvedValue({} as never);
        vi.mocked(securityQuotaService.getEffectiveQuota).mockResolvedValue({ maxDeploysPerAppPerHour: 1 } as never);
        vi.mocked(securityQuotaService.reserveDeployQuota).mockRejectedValue(new ServiceException('app deploy quota exceeded'));
        vi.mocked(dataAccess.client as any).$transaction = vi.fn(async (callback: any) => callback({
            deploymentRecord: {
                create: vi.fn(),
            },
        }));
        vi.mocked(buildService as any).buildApp = vi.fn();
        vi.mocked(deploymentService as any).createDeployment = vi.fn();
        vi.mocked(deploymentLogService as any).catchErrosAndLog = vi.fn(async (_deploymentId: string, fn: () => Promise<unknown>) => fn());

        await expect(appService.buildAndDeploy('demo-app', false, {
            actorType: 'USER',
            actorUserId: 'user-1',
            actorEmail: 'admin@example.com',
        })).rejects.toThrow('app deploy quota exceeded');

        expect(buildService.buildApp).not.toHaveBeenCalled();
        expect(deploymentService.createDeployment).not.toHaveBeenCalled();
        expect(auditService.recordRequired).toHaveBeenCalledWith(expect.objectContaining({
            action: 'APP_DEPLOY_REQUESTED',
            outcome: 'DENIED',
            actorEmail: 'admin@example.com',
            actorUserId: 'user-1',
            appId: 'demo-app',
            projectId: 'demo-project',
        }));
    });

    it('persists App Node Ports when saving an extended App', async () => {
        vi.spyOn(appService, 'save').mockResolvedValue({} as never);
        vi.spyOn(appService, 'saveDomain').mockResolvedValue({} as never);
        vi.spyOn(appService, 'saveVolume').mockResolvedValue({} as never);
        vi.spyOn(appService, 'saveFileMount').mockResolvedValue({} as never);
        vi.spyOn(appService, 'savePort').mockResolvedValue({} as never);
        vi.spyOn(appService, 'saveBasicAuth').mockResolvedValue({} as never);
        const saveNodePort = vi.spyOn(appService, 'saveNodePort').mockResolvedValue({} as never);

        await appService.saveAppExtendedModel(createApp({
            appNodePorts: [
                {
                    id: 'node-port-1',
                    appId: 'demo-app',
                    port: 300,
                    nodePort: 30080,
                    protocol: 'TCP',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        }));

        expect(saveNodePort).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'node-port-1',
                appId: 'demo-app',
                port: 300,
                nodePort: 30080,
                protocol: 'TCP',
            }),
            undefined
        );
    });
});

function createApp(overrides: Partial<AppExtendedModel>): AppExtendedModel {
    return {
        id: 'demo-app',
        name: 'Demo App',
        appType: 'APP',
        projectId: 'demo-project',
        project: {
            id: 'demo-project',
            name: 'Demo Project',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        sourceType: 'CONTAINER',
        buildMethod: 'RAILPACK',
        containerImageSource: null,
        containerRegistryUsername: null,
        containerRegistryPassword: null,
        containerCommand: null,
        containerArgs: null,
        runtimeClassName: null,
        securityContextRunAsUser: null,
        securityContextRunAsGroup: null,
        securityContextFsGroup: null,
        securityContextPrivileged: false,
        gitUrl: null,
        gitBranch: null,
        gitUsername: null,
        gitToken: null,
        dockerfilePath: './Dockerfile',
        replicas: 1,
        envVars: '',
        memoryReservation: null,
        memoryLimit: null,
        cpuReservation: null,
        cpuLimit: null,
        webhookId: null,
        ingressNetworkPolicy: 'ALLOW_ALL',
        egressNetworkPolicy: 'ALLOW_ALL',
        useNetworkPolicy: true,
        healthChechHttpGetPath: null,
        healthCheckHttpScheme: null,
        healthCheckHttpHeadersJson: null,
        healthCheckHttpPort: null,
        healthCheckPeriodSeconds: 15,
        healthCheckTimeoutSeconds: 5,
        healthCheckFailureThreshold: 3,
        healthCheckTcpPort: null,
        appDomains: [],
        appPorts: [],
        appNodePorts: [],
        appVolumes: [],
        appFileMounts: [],
        appBasicAuths: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}
