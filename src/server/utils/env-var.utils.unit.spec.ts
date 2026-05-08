import { EnvVarUtils } from './env-var.utils';
import { AppExtendedModel } from '@/shared/model/app-extended.model';

function createApp(overrides: Partial<AppExtendedModel> = {}): AppExtendedModel {
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
        appSecretEnvVars: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

describe('EnvVarUtils', () => {
    it('renders public env values and secret env references without exposing secret values', () => {
        const envVars = EnvVarUtils.parseEnvVariables(createApp({
            envVars: 'PUBLIC_URL=https://example.test',
            appSecretEnvVars: [{
                id: 'secret-1',
                appId: 'demo-app',
                name: 'API_TOKEN',
                encryptedValue: 'encrypted-secret-value',
                createdAt: new Date(),
                updatedAt: new Date(),
            }],
        }));

        expect(envVars).toEqual([
            { name: 'PUBLIC_URL', value: 'https://example.test' },
            {
                name: 'API_TOKEN',
                valueFrom: {
                    secretKeyRef: {
                        name: 'env-demo-app',
                        key: 'API_TOKEN',
                    },
                },
            },
        ]);
        expect(JSON.stringify(envVars)).not.toContain('encrypted-secret-value');
    });
});
