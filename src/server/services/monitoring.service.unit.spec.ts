const k8sMocks = vi.hoisted(() => ({ topPods: vi.fn(), Metrics: vi.fn() }));
const clusterMocks = vi.hoisted(() => ({ getNodeInfo: vi.fn() }));
const projectMocks = vi.hoisted(() => ({ getAllProjects: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));

vi.mock('@kubernetes/client-node', () => k8sMocks);
vi.mock('../adapter/kubernetes-api.adapter', () => ({ default: { core: {}, getKubeConfig: vi.fn(), metrics: {} } }));
vi.mock('./cluster.service', () => ({ default: clusterMocks }));
vi.mock('./project.service', () => ({ default: projectMocks }));
vi.mock('./standalone-services/standalone-pod.service', () => ({ default: podMocks }));
vi.mock('../adapter/longhorn-api.adapter', () => ({ default: {} }));
vi.mock('../adapter/db.client', () => ({ default: { client: { appVolume: { findMany: vi.fn() } } } }));
vi.mock('./pvc.service', () => ({ default: { getAllPvc: vi.fn() } }));

import monitoringService from './monitoring.service';

describe('monitoringService.getMonitoringForAllApps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clusterMocks.getNodeInfo.mockResolvedValue([{ cpuCapacity: '4', ramCapacity: '8Gi' }]);
        projectMocks.getAllProjects.mockResolvedValue([
            { id: 'proj-1', name: 'Project 1', apps: [{ id: 'app-1', name: 'App 1' }, { id: 'app-2', name: 'App 2' }] },
        ]);
        k8sMocks.topPods.mockResolvedValue([
            {
                Pod: { metadata: { namespace: 'proj-1', name: 'app-1-pod', labels: { app: 'app-1' } } },
                CPU: { CurrentUsage: 0.25 },
                Memory: { CurrentUsage: BigInt(104857600) },
            },
        ]);
    });

    it('builds app resource usage from metrics labels without listing pods per app', async () => {
        const result = await monitoringService.getMonitoringForAllApps();

        expect(podMocks.getPodsForApp).not.toHaveBeenCalled();
        expect(result).toEqual([
            expect.objectContaining({ appId: 'app-1', cpuUsage: 0.25, cpuUsagePercent: 6.25, ramUsageBytes: 104857600 }),
            expect.objectContaining({ appId: 'app-2', cpuUsage: 0, cpuUsagePercent: 0, ramUsageBytes: 0 }),
        ]);
    });
});
