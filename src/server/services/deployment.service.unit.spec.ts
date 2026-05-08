const k3sMocks = vi.hoisted(() => ({
    listNamespacedDeployment: vi.fn(),
    createNamespacedDeployment: vi.fn(),
    replaceNamespacedDeployment: vi.fn(),
}));

const runtimeClassMocks = vi.hoisted(() => ({
    assertRuntimeClassExists: vi.fn(),
}));

const paramMocks = vi.hoisted(() => ({
    getString: vi.fn(),
}));

vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({
    default: {
        apps: {
            listNamespacedDeployment: k3sMocks.listNamespacedDeployment,
            createNamespacedDeployment: k3sMocks.createNamespacedDeployment,
            replaceNamespacedDeployment: k3sMocks.replaceNamespacedDeployment,
        },
    },
}));

vi.mock('@/server/services/runtime-class.service', () => ({
    default: {
        assertRuntimeClassExists: runtimeClassMocks.assertRuntimeClassExists,
    },
}));

vi.mock('@/server/services/param.service', () => ({
    default: {
        getString: paramMocks.getString,
    },
    ParamService: {
        DEFAULT_APP_RUNTIME_CLASS: 'defaultAppRuntimeClass',
    },
}));

vi.mock('@/server/services/build.service', () => ({ default: {} }));
vi.mock('@/server/services/ingress.service', () => ({
    default: {
        createOrUpdateIngressForApp: vi.fn(),
    },
}));
vi.mock('@/server/services/pvc.service', () => ({
    default: {
        doesAppConfigurationIncreaseAnyPvcSize: vi.fn().mockResolvedValue(false),
        createOrUpdatePvc: vi.fn().mockResolvedValue({ volumes: [], volumeMounts: [] }),
        deleteUnusedPvcOfApp: vi.fn(),
    },
}));
vi.mock('@/server/services/namespace.service', () => ({
    default: {
        createNamespaceIfNotExists: vi.fn(),
    },
}));
vi.mock('@/server/services/svc.service', () => ({
    default: {
        createOrUpdateServiceForApp: vi.fn(),
    },
}));
vi.mock('@/server/services/deployment-logs.service', () => ({ dlog: vi.fn() }));
vi.mock('@/server/services/registry.service', () => ({
    default: {
        createContainerRegistryUrlForAppId: vi.fn((appId: string) => `registry/${appId}`),
    },
}));
vi.mock('@/server/services/config-map.service', () => ({
    default: {
        createOrUpdateConfigMapForApp: vi.fn().mockResolvedValue({ fileVolumeMounts: [], fileVolumes: [] }),
        deleteUnusedConfigMaps: vi.fn(),
    },
}));
vi.mock('@/server/services/secret.service', () => ({
    default: {
        createOrUpdateDockerPullSecret: vi.fn().mockResolvedValue(undefined),
        delteUnusedSecrets: vi.fn(),
    },
}));
vi.mock('@/server/services/file-browser-service', () => ({
    default: {
        deleteFileBrowserForVolumeIfExists: vi.fn(),
    },
}));
vi.mock('@/server/services/pod.service', () => ({ default: {} }));
vi.mock('@/server/services/network-policy.service', () => ({
    default: {
        reconcileNetworkPolicy: vi.fn(),
    },
}));

import deploymentService from './deployment.service';
import { AppExtendedModel } from '@/shared/model/app-extended.model';
import { ServiceException } from '@/shared/model/service.exception.model';

describe('deployment.service RuntimeClass support', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        k3sMocks.listNamespacedDeployment.mockResolvedValue({ body: { items: [] } });
        runtimeClassMocks.assertRuntimeClassExists.mockResolvedValue(undefined);
        paramMocks.getString.mockResolvedValue(undefined);
    });

    it('sets runtimeClassName on the pod template when configured', async () => {
        await deploymentService.createDeployment('deployment-1', createApp({ runtimeClassName: 'kata' }));

        expect(runtimeClassMocks.assertRuntimeClassExists).toHaveBeenCalledWith('kata');
        const [, body] = k3sMocks.createNamespacedDeployment.mock.calls[0];
        expect(body.spec.template.spec.runtimeClassName).toBe('kata');
    });

    it('uses the server default RuntimeClass when no app override is configured', async () => {
        paramMocks.getString.mockResolvedValue('kata-default');

        await deploymentService.createDeployment('deployment-1', createApp({ runtimeClassName: null }));

        expect(runtimeClassMocks.assertRuntimeClassExists).toHaveBeenCalledWith('kata-default');
        const [, body] = k3sMocks.createNamespacedDeployment.mock.calls[0];
        expect(body.spec.template.spec.runtimeClassName).toBe('kata-default');
    });

    it('prefers the app RuntimeClass override over the server default', async () => {
        paramMocks.getString.mockResolvedValue('kata-default');

        await deploymentService.createDeployment('deployment-1', createApp({ runtimeClassName: 'kata-qemu' }));

        expect(runtimeClassMocks.assertRuntimeClassExists).toHaveBeenCalledWith('kata-qemu');
        const [, body] = k3sMocks.createNamespacedDeployment.mock.calls[0];
        expect(body.spec.template.spec.runtimeClassName).toBe('kata-qemu');
    });

    it('omits runtimeClassName from the serialized body when unset', async () => {
        await deploymentService.createDeployment('deployment-1', createApp({ runtimeClassName: null }));

        const [, body] = k3sMocks.createNamespacedDeployment.mock.calls[0];
        expect(JSON.stringify(body)).not.toContain('runtimeClassName');
    });

    it('fails before applying the Deployment when the RuntimeClass is unavailable', async () => {
        runtimeClassMocks.assertRuntimeClassExists.mockRejectedValue(new ServiceException('RuntimeClass "missing" is not available in this cluster.'));

        await expect(deploymentService.createDeployment('deployment-1', createApp({ runtimeClassName: 'missing' })))
            .rejects.toThrow('RuntimeClass "missing" is not available');

        expect(k3sMocks.createNamespacedDeployment).not.toHaveBeenCalled();
        expect(k3sMocks.replaceNamespacedDeployment).not.toHaveBeenCalled();
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
        containerImageSource: 'nginx:latest',
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
