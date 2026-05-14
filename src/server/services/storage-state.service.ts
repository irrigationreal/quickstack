import appService from "./app.service";
import podService from "./pod.service";
import longhornApiAdapter from "../adapter/longhorn-api.adapter";
import type { StorageState } from "@/shared/model/agent-volume.model";

class StorageStateService {
    async getForApp(appId: string): Promise<StorageState> {
        const app = await appService.getExtendedById(appId, false);
        const pods = await podService.getPodsForApp(app.projectId, app.id).catch(() => []);
        const attachedPods = pods.map(pod => pod.podName);
        const longhornVolumes = await longhornApiAdapter.getAllLonghornVolumes().catch(() => []);
        const longhornVolumeByName = new Map(longhornVolumes.map(volume => [volume.name, volume]));
        const volumes = app.appVolumes.map(volume => {
            const name = volume.containerMountPath.split('/').filter(Boolean).join('-') || volume.id;
            const longhornVolume = volume.storageClassName === 'longhorn' ? longhornVolumeByName.get(name) : undefined;
            const used = longhornVolume?.actualSizeBytes;
            const size = longhornVolume?.sizeBytes ?? volume.size;
            return {
                id: volume.id,
                name,
                size,
                storageClass: volume.storageClassName,
                mountPath: volume.containerMountPath,
                accessMode: volume.accessMode,
                attachedPods,
                used,
                free: used === undefined ? undefined : Math.max(size - used, 0),
            };
        });
        const snapshots = (await Promise.all(volumes.map(volume =>
            volume.storageClass === 'longhorn'
                ? longhornApiAdapter.getSnapshotsForVolume(volume.name).catch(() => [])
                : Promise.resolve([]),
        ))).flat();
        return {
            volumes,
            totalSize: volumes.reduce((sum, volume) => sum + volume.size, 0),
            totalUsed: volumes.some(volume => volume.used !== undefined) ? volumes.reduce((sum, volume) => sum + (volume.used ?? 0), 0) : undefined,
            snapshots,
        };
    }
}

const storageStateService = new StorageStateService();
export default storageStateService;
