const k3sMocks = vi.hoisted(() => ({
    readNamespacedConfigMap: vi.fn(),
    createNamespacedConfigMap: vi.fn(),
    replaceNamespacedConfigMap: vi.fn(),
    deleteNamespacedConfigMap: vi.fn(),
    readNamespacedDeployment: vi.fn(),
    createNamespacedDeployment: vi.fn(),
    replaceNamespacedDeployment: vi.fn(),
    deleteNamespacedDeployment: vi.fn(),
}));

const namespaceMocks = vi.hoisted(() => ({
    createNamespaceIfNotExists: vi.fn(),
}));

const dataAccessMocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    updateMany: vi.fn(),
}));

vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({
    default: {
        core: {
            readNamespacedConfigMap: k3sMocks.readNamespacedConfigMap,
            createNamespacedConfigMap: k3sMocks.createNamespacedConfigMap,
            replaceNamespacedConfigMap: k3sMocks.replaceNamespacedConfigMap,
            deleteNamespacedConfigMap: k3sMocks.deleteNamespacedConfigMap,
        },
        apps: {
            readNamespacedDeployment: k3sMocks.readNamespacedDeployment,
            createNamespacedDeployment: k3sMocks.createNamespacedDeployment,
            replaceNamespacedDeployment: k3sMocks.replaceNamespacedDeployment,
            deleteNamespacedDeployment: k3sMocks.deleteNamespacedDeployment,
        },
    },
}));

vi.mock('@/server/adapter/db.client', () => ({
    default: {
        client: {
            appPublicEndpoint: {
                findMany: dataAccessMocks.findMany,
                updateMany: dataAccessMocks.updateMany,
            },
        },
    },
}));

vi.mock('@/server/services/namespace.service', () => ({
    default: {
        createNamespaceIfNotExists: namespaceMocks.createNamespaceIfNotExists,
    },
}));

import publicEndpointService from './public-endpoint.service';

describe('public-endpoint.service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        k3sMocks.readNamespacedConfigMap.mockRejectedValue(new Error('not found'));
        k3sMocks.readNamespacedDeployment.mockRejectedValue(new Error('not found'));
        dataAccessMocks.updateMany.mockResolvedValue({ count: 2 });
    });

    it('renders one host-network gateway for multiple TCP reservations on the same public IP', async () => {
        dataAccessMocks.findMany.mockResolvedValue([
            endpoint('ep-a', 2222, 22, 'ssh-app', 'demo-project', true),
            endpoint('ep-b', 25565, 25565, 'minecraft-app', 'demo-project'),
        ]);

        await publicEndpointService.reconcileGatewayForIp('65.21.9.20');

        expect(namespaceMocks.createNamespaceIfNotExists).toHaveBeenCalledWith('quickstack-public-endpoints');
        const [, configMap] = k3sMocks.createNamespacedConfigMap.mock.calls[0];
        expect(configMap.data['haproxy.cfg']).toContain('bind 65.21.9.20:2222');
        expect(configMap.data['haproxy.cfg']).toContain('server app svc-ssh-app.demo-project.svc.cluster.local:22 check send-proxy');
        expect(configMap.data['haproxy.cfg']).toContain('bind 65.21.9.20:25565');
        expect(configMap.data['haproxy.cfg']).toContain('server app svc-minecraft-app.demo-project.svc.cluster.local:25565 check');

        const [, deployment] = k3sMocks.createNamespacedDeployment.mock.calls[0];
        expect(deployment.spec.template.spec.hostNetwork).toBe(true);
        expect(deployment.spec.template.spec.containers[0].ports).toEqual(expect.arrayContaining([
            expect.objectContaining({ containerPort: 2222, hostPort: 2222, protocol: 'TCP' }),
            expect.objectContaining({ containerPort: 25565, hostPort: 25565, protocol: 'TCP' }),
        ]));
        expect(deployment.spec.template.spec.containers[0].readinessProbe).toEqual({
            exec: {
                command: ['sh', '-c', 'pidof haproxy >/dev/null && haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg >/dev/null'],
            },
            initialDelaySeconds: 2,
            periodSeconds: 10,
        });
    });

    it('deletes the gateway when the IP has no active TCP endpoints', async () => {
        dataAccessMocks.findMany.mockResolvedValue([]);
        k3sMocks.readNamespacedConfigMap.mockResolvedValue({ body: {} });
        k3sMocks.readNamespacedDeployment.mockResolvedValue({ body: {} });

        await publicEndpointService.reconcileGatewayForIp('65.21.9.20');

        expect(k3sMocks.deleteNamespacedDeployment).toHaveBeenCalledWith('qs-endpoint-65-21-9-20', 'quickstack-public-endpoints');
        expect(k3sMocks.deleteNamespacedConfigMap).toHaveBeenCalledWith('qs-endpoint-65-21-9-20', 'quickstack-public-endpoints');
    });
});

function endpoint(id: string, publicPort: number, targetPort: number, appId: string, projectId: string, proxyProtocol = false) {
    return {
        id,
        appId,
        name: null,
        publicIp: '65.21.9.20',
        publicPort,
        targetPort,
        protocol: 'TCP',
        sourceCidrsJson: null,
        proxyProtocol,
        enabled: true,
        status: 'PENDING',
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        app: {
            id: appId,
            name: appId,
            projectId,
        },
    };
}
