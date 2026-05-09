import k3s from "../adapter/kubernetes-api.adapter";
import { V1ConfigMapList, V1Deployment, V1DeploymentList, V1NetworkPolicy, V1NetworkPolicyList, V1PersistentVolumeClaimList, V1ServiceList } from "@kubernetes/client-node";
import namespaceService from "./namespace.service";
import podService from "./pod.service";
import registryApiAdapter from "../adapter/registry-api.adapter";
import paramService, { ParamService } from "./param.service";
import { Constants } from "@/shared/utils/constants";
import { S3Target } from "@prisma/client";
import s3TargetService from "./s3-target.service";
import clusterService from "./cluster.service";
import { ServiceException } from "@/shared/model/service.exception.model";

const REGISTRY_NODE_PORT = 30100;
const REGISTRY_CONTAINER_PORT = 5000;
const REGISTRY_SVC_NAME = 'registry-svc';
const REGISTRY_PVC_NAME = 'registry-data-pvc';
const REGISTRY_CONFIG_MAP_NAME = 'registry-config-map';
const REGISTRY_NETWORK_POLICY_NAME = 'registry-ingress-policy';
export const BUILD_NAMESPACE = "registry-and-build";
export const REGISTRY_URL_EXTERNAL = `localhost:${REGISTRY_NODE_PORT}`;
export const REGISTRY_URL_INTERNAL = `${REGISTRY_SVC_NAME}.${BUILD_NAMESPACE}.svc.cluster.local:${REGISTRY_CONTAINER_PORT}`


class RegistryService {

    async purgeRegistryImages() {
        const allImages = await registryApiAdapter.getAllImages();
        let totalSize = 0;
        for (const image of allImages) {
            const tags = await registryApiAdapter.listTagsForImage(image);
            for (const tag of tags) {
                totalSize += await registryApiAdapter.deleteImage(image, tag);
            }
        }
        await this.runGarbageCollection();
        return totalSize;
    }

    private async runGarbageCollection() {
        const pods = await podService.getPodsForApp(BUILD_NAMESPACE, 'registry');
        if (pods.length !== 1) {
            throw new Error('Cannot run garbage collection, because registry is not running.');
        }
        console.log("Running garbage collection...");
        await podService.runCommandInPod(BUILD_NAMESPACE, pods[0].podName, pods[0].containerName, ['bin/registry', 'garbage-collect', '/etc/docker/registry/config.yml']);
        console.log("Garbage collection completed.");
    }

    async doesImageExist(image: string, tag: string) {
        const images = await registryApiAdapter.getAllImages();
        for (const i of images) {
            if (i === image) {
                const tags = await registryApiAdapter.listTagsForImage(image);
                if (tags.includes(tag)) {
                    return true;
                }
            }
        }
        return false;
    }

    createInternalContainerRegistryUrlForAppId(appId?: string, tag = 'latest') {
        if (!appId) {
            return undefined;
        }
        return `${REGISTRY_URL_INTERNAL}/${appId}:${tag}`;
    }

    createContainerRegistryUrlForAppId(appId?: string, tag = 'latest') {
        if (!appId) {
            return undefined;
        }
        return `${REGISTRY_URL_EXTERNAL}/${appId}:${tag}`;
    }

    createManagedQuickDeployImageUrl(appId: string, contentHash: string, buildId: string) {
        const contentHashPrefix = contentHash.replace(/^sha256:/, '').slice(0, 16);
        return `${REGISTRY_URL_INTERNAL}/${appId}:qd-${contentHashPrefix}-${buildId.slice(0, 8)}`;
    }

    async deployRegistry(registryLocation: string, forceDeploy = false) {
        const useLocalStorage = registryLocation === Constants.INTERNAL_REGISTRY_LOCATION;
        const s3Target = useLocalStorage ? undefined : await s3TargetService.getById(registryLocation!);

        console.log("Ensuring namespace is created...");
        await namespaceService.createNamespaceIfNotExists(BUILD_NAMESPACE);

        // Always update the ConfigMap and NetworkPolicy so storage and registry ingress settings are never stale
        await this.createOrUpdateRegistryConfigMap(s3Target);
        await this.createOrUpdateRegistryNetworkPolicy();

        const deployments = await k3s.apps.listNamespacedDeployment(BUILD_NAMESPACE) as { body: V1DeploymentList };
        if (deployments.body.items.length > 0 && !forceDeploy) {
            return;
        }

        console.log("(Re)deploying registry because it is not deployed or forced...");
        console.log(`Registry storage location is set to ${registryLocation}.`);

        if (useLocalStorage) {
            await this.createPersistenvColumeCLaim();
        }

        await this.createOrUpdateRegistryDeployment(useLocalStorage);

        await this.createOrUpdateRegistryService();

        console.log("Waiting for registry to be deployed...");
        const pods = await podService.getPodsForApp(BUILD_NAMESPACE, 'registry');
        if (pods.length === 1) {
            await podService.waitUntilPodIsRunningFailedOrSucceded(BUILD_NAMESPACE, pods[0].podName)
        }

        console.log("Registry deployed successfully.");
        await new Promise(resolve => setTimeout(resolve, 5000)); // wait a bit for the registry to be ready
    }

    private async createPersistenvColumeCLaim() {
        console.log("Creating Registry PVC...");
        const pvcManifest = {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: {
                name: REGISTRY_PVC_NAME,
                namespace: BUILD_NAMESPACE,
            },
            spec: {
                accessModes: ['ReadWriteOnce'],
                storageClassName: 'local-path',
                resources: {
                    requests: {
                        storage: '10Gi',
                    },
                },
            },
        };

        const listRes = await k3s.core.listNamespacedPersistentVolumeClaim(BUILD_NAMESPACE) as { body: V1PersistentVolumeClaimList };
        if (listRes.body.items.find(pvc => pvc.metadata?.name === REGISTRY_PVC_NAME)) {
            console.log("PVC already exists, skipping creation...");
            return;
        }
        await k3s.core.createNamespacedPersistentVolumeClaim(BUILD_NAMESPACE, pvcManifest);
    }

    private async createOrUpdateRegistryService() {
        console.log("Creating Registry Service...");
        const serviceManifest = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: {
                name: REGISTRY_SVC_NAME,
                namespace: BUILD_NAMESPACE,
            },
            spec: {
                selector: {
                    app: 'registry',
                },
                ports: [
                    {
                        nodePort: REGISTRY_NODE_PORT,
                        protocol: 'TCP',
                        port: REGISTRY_CONTAINER_PORT,
                        targetPort: REGISTRY_CONTAINER_PORT,
                    },
                ],
                type: 'NodePort',
            },
        };

        const existingServices = await k3s.core.listNamespacedService(BUILD_NAMESPACE) as { body: V1ServiceList };
        if (existingServices.body.items.find(svc => svc.metadata?.name === REGISTRY_SVC_NAME)) {
            console.log("Service already exists, deleting and recreating...");
            await k3s.core.deleteNamespacedService(REGISTRY_SVC_NAME, BUILD_NAMESPACE);
        }

        await k3s.core.createNamespacedService(BUILD_NAMESPACE, serviceManifest);
    }

    private async createOrUpdateRegistryNetworkPolicy() {
        console.log("Creating Registry NetworkPolicy...");
        const networkPolicyManifest: V1NetworkPolicy = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'NetworkPolicy',
            metadata: {
                name: REGISTRY_NETWORK_POLICY_NAME,
                namespace: BUILD_NAMESPACE,
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        app: 'registry',
                    },
                },
                policyTypes: ['Ingress'],
                ingress: [
                    {
                        _from: [
                            {
                                podSelector: {},
                            },
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        'kubernetes.io/metadata.name': 'quickstack',
                                    },
                                },
                                podSelector: {
                                    matchLabels: {
                                        app: 'quickstack',
                                    },
                                },
                            },
                        ],
                        ports: [{ protocol: 'TCP', port: REGISTRY_CONTAINER_PORT as any }],
                    },
                ],
            },
        };

        const existingNetworkPolicies = await k3s.network.listNamespacedNetworkPolicy(BUILD_NAMESPACE) as { body: V1NetworkPolicyList };
        if (existingNetworkPolicies.body.items.find(policy => policy.metadata?.name === REGISTRY_NETWORK_POLICY_NAME)) {
            await k3s.network.replaceNamespacedNetworkPolicy(REGISTRY_NETWORK_POLICY_NAME, BUILD_NAMESPACE, networkPolicyManifest);
            return;
        }
        await k3s.network.createNamespacedNetworkPolicy(BUILD_NAMESPACE, networkPolicyManifest);
    }

    private async createOrUpdateRegistryDeployment(useLocalStorage = true) {
        console.log("Creating Registry Deployment...");

        const deploymentName = 'registry';

        const masterNode = await clusterService.getFirstMasterNode();
        if (useLocalStorage && !masterNode) {
            throw new ServiceException("Cannot deploy registry with local storage, because could not evaluate master node.");
        }
        const registryPlacement = useLocalStorage ? {
            nodeSelector: {
                'kubernetes.io/hostname': masterNode.name,
            }
        } : {};

        const localStorageVolumeMount = useLocalStorage ? [{
            name: 'registry-data-pv',
            mountPath: '/var/lib/registry',
        }] : [];

        const localStorageVolume = useLocalStorage ? [{
            name: 'registry-data-pv',
            persistentVolumeClaim: {
                claimName: REGISTRY_PVC_NAME,
            },
        }] : [];

        const deploymentManifest: V1Deployment = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: {
                name: deploymentName,
                namespace: BUILD_NAMESPACE,
            },
            spec: {
                replicas: 1,
                strategy: {
                    type: 'Recreate',
                },
                selector: {
                    matchLabels: {
                        app: deploymentName,
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            app: deploymentName,
                        },
                    },
                    spec: {
                        ...registryPlacement,
                        containers: [
                            {
                                name: deploymentName,
                                image: 'registry:2.8',
                                volumeMounts: [
                                    ...localStorageVolumeMount,
                                    {
                                        name: REGISTRY_CONFIG_MAP_NAME,
                                        mountPath: '/etc/docker/registry',
                                        readOnly: true,
                                    }
                                ],
                            },
                        ],
                        volumes: [
                            ...localStorageVolume,
                            {
                                name: REGISTRY_CONFIG_MAP_NAME,
                                configMap: {
                                    name: REGISTRY_CONFIG_MAP_NAME,
                                },
                            },
                        ],
                    },
                },
            },
        };

        const existingDeployments = await k3s.apps.listNamespacedDeployment(BUILD_NAMESPACE) as { body: V1DeploymentList };
        if (existingDeployments.body.items.find(dep => dep.metadata?.name === deploymentName)) {
            console.log("Deployment already exists, deleting and recreating...");
            await k3s.apps.deleteNamespacedDeployment(deploymentName, BUILD_NAMESPACE);
        }

        await k3s.apps.createNamespacedDeployment(BUILD_NAMESPACE, deploymentManifest);
    }

    private async createOrUpdateRegistryConfigMap(s3Target?: S3Target) {

        /* DO NOT REFORMAT THESE TWO STRINGS */
        let storageProvider = '';
        if (s3Target) {
            let storageS3provider = `  s3:
    accesskey: ${s3Target.accessKeyId}
    secretkey: ${s3Target.secretKey}
    region: ${s3Target.region}
    bucket: ${s3Target.bucketName}
    loglevel: debug`;
            if (s3Target.endpoint) {
                storageS3provider += `\n    regionendpoint: ${s3Target.endpoint}`;
            }
            storageProvider = storageS3provider;
        } else {
            const storageFilesSystemprovider = `  filesystem:
    rootdirectory: /var/lib/registry`;
            storageProvider = storageFilesSystemprovider;
        }


        // Source: https://distribution.github.io/distribution/about/configuration/
        console.log("Creating Registry ConfigMap...");
        const configMapManifest = {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: {
                name: REGISTRY_CONFIG_MAP_NAME,
                namespace: BUILD_NAMESPACE,
            },
            data: {
                'config.yml': `
version: 0.1
log:
  fields:
    service: registry
storage:
${storageProvider}
  delete:
    enabled: true
  maintenance:
    uploadpurging:
      enabled: true
      age: 10h
      interval: 24h
      dryrun: false
    readonly:
      enabled: false
http:
  addr: :5000
  headers:
    X-Content-Type-Options: [nosniff]
`
            },
        };
        const existingConfigMaps = await k3s.core.listNamespacedConfigMap(BUILD_NAMESPACE) as { body: V1ConfigMapList };
        if (existingConfigMaps.body.items.find(cm => cm.metadata?.name === REGISTRY_CONFIG_MAP_NAME)) {
            console.log("ConfigMap already exists, deleting and recreating...");
            await k3s.core.deleteNamespacedConfigMap(REGISTRY_CONFIG_MAP_NAME, BUILD_NAMESPACE);
        }

        await k3s.core.createNamespacedConfigMap(BUILD_NAMESPACE, configMapManifest);
    }
}

const registryService = new RegistryService();
export default registryService;
