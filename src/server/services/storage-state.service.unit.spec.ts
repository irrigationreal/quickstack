const appMocks = vi.hoisted(() => ({ getExtendedById: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const longhornMocks = vi.hoisted(() => ({ getAllLonghornVolumes: vi.fn(), getSnapshotsForVolume: vi.fn() }));

vi.mock('./app.service', () => ({ default: appMocks }));
vi.mock('./pod.service', () => ({ default: podMocks }));
vi.mock('../adapter/longhorn-api.adapter', () => ({ default: longhornMocks }));

import storageStateService from './storage-state.service';

describe('storageStateService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appMocks.getExtendedById.mockResolvedValue({
            id: 'app-1',
            projectId: 'proj-1',
            appVolumes: [{ id: 'vol-1', containerMountPath: '/data', size: 1024, storageClassName: 'longhorn', accessMode: 'ReadWriteOnce' }],
        });
        podMocks.getPodsForApp.mockResolvedValue([{ podName: 'pod-1' }]);
        longhornMocks.getAllLonghornVolumes.mockResolvedValue([{ name: 'data', actualSizeBytes: 256, sizeBytes: 1024 }]);
        longhornMocks.getSnapshotsForVolume.mockResolvedValue([{ id: 'snap-1', volumeId: 'data', createdAt: '2026-05-14T00:00:00Z' }]);
    });

    it('returns used and free storage metrics for Longhorn volumes', async () => {
        const state = await storageStateService.getForApp('app-1');

        expect(state.volumes[0]).toEqual(expect.objectContaining({ name: 'data', used: 256, free: 768, attachedPods: ['pod-1'] }));
        expect(state.totalUsed).toBe(256);
        expect(state.snapshots?.[0]).toEqual(expect.objectContaining({ id: 'snap-1', volumeId: 'data' }));
    });
});
