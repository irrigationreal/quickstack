import k3s from "../adapter/kubernetes-api.adapter";
import * as k8s from '@kubernetes/client-node';
import standalonePodService from "./standalone-services/standalone-pod.service";
import clusterService from "./cluster.service";
import { PodsResourceInfoModel } from "@/shared/model/pods-resource-info.model";
import { KubeSizeConverter } from "../../shared/utils/kubernetes-size-converter.utils";
import { AppVolumeMonitoringUsageModel } from "@/shared/model/app-volume-monitoring-usage.model";
import longhornApiAdapter from "../adapter/longhorn-api.adapter";
import dataAccess from "../adapter/db.client";
import pvcService from "./pvc.service";
import { KubeObjectNameUtils } from "../utils/kube-object-name.utils";
import projectService from "./project.service";
import { AppMonitoringUsageModel } from "@/shared/model/app-monitoring-usage.model";
import { getKubernetesListItems, KubernetesListResponse } from "../utils/kubernetes-client-compat.utils";

type PodMetric = {
    metadata?: { name?: string; namespace?: string };
    containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
};

type PodResourceUsage = {
    pod: k8s.V1Pod;
    cpuCores: number;
    memoryBytes: number;
};

class MonitorService {

    async getAllAppVolumesUsage() {
        const [longhornData, appVolumes, pvcs] = await Promise.all([
            longhornApiAdapter.getAllLonghornVolumes(),
            dataAccess.client.appVolume.findMany({
                include: {
                    app: {
                        include: {
                            project: true
                        }
                    }
                },
                orderBy: {
                    appId: 'asc'
                }
            }),
            pvcService.getAllPvc()
        ]);

        const appVolumesWithUsage: AppVolumeMonitoringUsageModel[] = [];
        const volumeMap = new Map(appVolumes.map(volume => [volume.id, volume]));

        for (const appVolume of appVolumes) {
            const sharedVolumeId = (appVolume as { sharedVolumeId?: string | null }).sharedVolumeId;
            const baseVolumeId = sharedVolumeId ?? appVolume.id;
            const baseVolume = volumeMap.get(baseVolumeId);
            const pvc = pvcs.find(pvc => pvc.metadata?.name === KubeObjectNameUtils.toPvcName(baseVolumeId));
            if (!pvc) {
                continue;
            }
            const volumeName = pvc.spec?.volumeName;
            const longhornVolume = longhornData.find(volume => volume.name === volumeName);
            if (!longhornVolume) {
                continue;
            }

            appVolumesWithUsage.push({
                projectId: appVolume.app.projectId,
                projectName: appVolume.app.project.name,
                appName: appVolume.app.name,
                appId: appVolume.appId,
                mountPath: appVolume.containerMountPath,
                usedBytes: longhornVolume.actualSizeBytes,
                capacityBytes: KubeSizeConverter.fromMegabytesToBytes(baseVolume?.size ?? appVolume.size),
                isBaseVolume: !sharedVolumeId
            });
        }

        // sort appVolumesWithUsage first by projectName (asc) then by appName
        appVolumesWithUsage.sort((a, b) => {
            if (a.projectName === b.projectName) {
                return a.appName.localeCompare(b.appName);
            }
            return a.projectName.localeCompare(b.projectName);
        });
        return appVolumesWithUsage;
    }

    async getMonitoringForAllApps() {
        const [topPods, totalResourcesNodes, projects] = await Promise.all([
            this.getTopPods(),
            this.getTotalAvailableNodeResources(),
            projectService.getAllProjects()
        ]);

        const appStats: AppMonitoringUsageModel[] = [];
        const topPodsByApp = new Map<string, PodResourceUsage[]>();
        for (const topPod of topPods) {
            const namespace = topPod.pod.metadata?.namespace;
            const appId = topPod.pod.metadata?.labels?.app;
            if (!namespace || !appId) continue;
            const key = `${namespace}/${appId}`;
            const appPods = topPodsByApp.get(key);
            if (appPods) {
                appPods.push(topPod);
            } else {
                topPodsByApp.set(key, [topPod]);
            }
        }

        for (const project of projects) {
            for (const app of project.apps) {
                const filteredTopPods = topPodsByApp.get(`${project.id}/${app.id}`) ?? [];
                const totalResourcesApp = this.calculateTotalResourceUsageOfApp(filteredTopPods);
                const cpuUsagePercent = totalResourcesNodes.cpu > 0 ? (totalResourcesApp.cpu / totalResourcesNodes.cpu) * 100 : 0;
                appStats.push({
                    projectId: project.id,
                    projectName: project.name,
                    appName: app.name,
                    appId: app.id,
                    cpuUsage: totalResourcesApp.cpu,
                    cpuUsagePercent,
                    ramUsageBytes: totalResourcesApp.ramBytes
                })
            }
        }
        appStats.sort((a, b) => {
            if (a.projectName === b.projectName) {
                return a.appName.localeCompare(b.appName);
            }
            return a.projectName.localeCompare(b.projectName);
        });
        return appStats;
    }

    async getMonitoringForApp(projectId: string, appId: string): Promise<PodsResourceInfoModel> {
        const [podsFromApp, topPods, totalResourcesNodes] = await Promise.all([
            standalonePodService.getPodsForApp(projectId, appId),
            this.getTopPods(projectId),
            this.getTotalAvailableNodeResources(),
        ]);
        const podNames = new Set(podsFromApp.map((pod) => pod.podName));
        const filteredTopPods = topPods.filter((topPod) => podNames.has(topPod.pod.metadata?.name ?? ''));
        const totalResourcesApp = this.calculateTotalResourceUsageOfApp(filteredTopPods);

        const totalRamNodesCorrectUnit: number = totalResourcesNodes.ramBytes;
        const totalRamAppCorrectUnit: number = totalResourcesApp.ramBytes;

        const appCpuUsagePercent = totalResourcesNodes.cpu > 0 ? ((totalResourcesApp.cpu / totalResourcesNodes.cpu) * 100) : 0;
        const appRamUsagePercent = totalRamNodesCorrectUnit > 0 ? ((totalRamAppCorrectUnit / totalRamNodesCorrectUnit) * 100) : 0;

        return {
            cpuPercent: appCpuUsagePercent,
            cpuAbsolutCores: totalResourcesApp.cpu,
            ramPercent: appRamUsagePercent,
            ramAbsolutBytes: totalRamAppCorrectUnit
        }
    }

    private calculateTotalResourceUsageOfApp(filteredTopPods: PodResourceUsage[]) {
        return filteredTopPods.reduce(
            (acc, pod) => {
                acc.cpu += pod.cpuCores;
                acc.ramBytes += pod.memoryBytes;
                return acc;
            },
            { cpu: 0, ramBytes: 0 }
        );
    }

    private async getTopPods(namespace?: string): Promise<PodResourceUsage[]> {
        const [podMetricsResponse, podListResponse] = await Promise.all([
            k3s.metrics.getPodMetrics(namespace),
            namespace ? k3s.core.listNamespacedPod(namespace) : k3s.core.listPodForAllNamespaces(),
        ]);
        const podMetrics = getKubernetesListItems<PodMetric>(podMetricsResponse as KubernetesListResponse<PodMetric>);
        const pods = getKubernetesListItems<k8s.V1Pod>(podListResponse as KubernetesListResponse<k8s.V1Pod>);
        const podsByKey = new Map(pods.map(pod => [`${pod.metadata?.namespace ?? namespace}/${pod.metadata?.name}`, pod]));

        return podMetrics.flatMap((metric) => {
            const pod = podsByKey.get(`${metric.metadata?.namespace ?? namespace}/${metric.metadata?.name}`);
            if (!pod) return [];
            const containers = metric.containers ?? [];
            return [{
                pod,
                cpuCores: containers.reduce((total, container) => total + KubeSizeConverter.fromKubeCpuToCores(container.usage?.cpu), 0),
                memoryBytes: containers.reduce((total, container) => total + KubeSizeConverter.fromOptionalKubeSizeToBytes(container.usage?.memory), 0),
            }];
        });
    }

    private async getTotalAvailableNodeResources() {
        const topNodes = await clusterService.getNodeInfo();
        const totalResourcesNodes = topNodes.reduce(
            (acc, node) => {
                acc.cpu += Number(node.cpuCapacity) || 0;
                acc.ramBytes += KubeSizeConverter.fromKubeSizeToBytes(node.ramCapacity) || 0;
                return acc;
            },
            { cpu: 0, ramBytes: 0 }
        );
        return totalResourcesNodes;
    }

    async getPvcUsageFromApp(appId: string, projectId: string): Promise<Array<{ pvcName: string, usedBytes: number }>> {
        const appVolumes = await dataAccess.client.appVolume.findMany({
            where: {
                appId
            },
            select: {
                id: true,
                sharedVolumeId: true
            }
        });
        if (appVolumes.length === 0) {
            return [];
        }
        const baseVolumeIds = Array.from(new Set(appVolumes.map(volume => (volume as { sharedVolumeId?: string | null }).sharedVolumeId || volume.id)));
        const pvcNames = new Set(baseVolumeIds.map(id => KubeObjectNameUtils.toPvcName(id)));
        const pvcFromProject = await k3s.core.listNamespacedPersistentVolumeClaim(projectId) as { body: k8s.V1PersistentVolumeClaimList };
        const pvcUsageData: Array<{ pvcName: string, usedBytes: number }> = [];

        for (const pvc of pvcFromProject.body.items) {
            const pvcName = pvc.metadata?.name;
            const volumeName = pvc.spec?.volumeName;

            if (pvcName && volumeName && pvcNames.has(pvcName as `pvc-${string}`)) {
                const usedBytes = await longhornApiAdapter.getLonghornVolume(volumeName);
                pvcUsageData.push({ pvcName, usedBytes });
            }
        }
        return pvcUsageData;
    }
}

const monitoringService = new MonitorService();
export default monitoringService;
