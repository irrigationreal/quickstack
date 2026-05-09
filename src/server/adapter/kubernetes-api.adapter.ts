import { ServiceException } from '@/shared/model/service.exception.model';
import * as k8s from '@kubernetes/client-node';
import { withLegacyKubernetesResponses } from '../utils/kubernetes-client-compat.utils';

class K3sApiAdapter {

    core: any;
    apps: any;
    batch: any;
    log: k8s.Log;
    network: any;
    node: any;
    customObjects: any;
    metrics: k8s.Metrics;

    constructor() {
        this.core = this.getK8sCoreApiClient();
        this.apps = this.getK8sAppsApiClient();
        this.batch = this.getK8sBatchApiClient();
        this.log = this.getK8sLogApiClient();
        this.network = this.getK8sNetworkApiClient();
        this.node = this.getK8sNodeApiClient();
        this.customObjects = this.getK8sCustomObjectsApiClient();
        this.metrics = this.getMetricsApiClient();
    }

    getKubeConfig = () => {
        const kc = new k8s.KubeConfig();
        if (process.env.NODE_ENV === 'production') {
            kc.loadFromCluster();
        } else {
            kc.loadFromFile('/workspace/kube-config.config');
        }
        return kc;
    }

    getK8sCoreApiClient = () => {
        const kc = this.getKubeConfig()
        const k8sCoreClient = kc.makeApiClient(k8s.CoreV1Api);
        return withLegacyKubernetesResponses(k8sCoreClient);
    }

    getK8sAppsApiClient = () => {
        const kc = this.getKubeConfig()
        const k8sCoreClient = kc.makeApiClient(k8s.AppsV1Api);
        return withLegacyKubernetesResponses(k8sCoreClient);
    }

    getK8sBatchApiClient = () => {
        const kc = this.getKubeConfig()
        const k8sJobClient = kc.makeApiClient(k8s.BatchV1Api);
        return withLegacyKubernetesResponses(k8sJobClient);
    }

    getK8sLogApiClient = () => {
        const kc = this.getKubeConfig()
        const logClient = new k8s.Log(kc)
        return logClient;
    }

    getK8sCustomObjectsApiClient = () => {
        const kc = this.getKubeConfig()
        const client = kc.makeApiClient(k8s.CustomObjectsApi);
        return withLegacyKubernetesResponses(client);
    }

    getK8sNetworkApiClient = () => {
        const kc = this.getKubeConfig()
        const networkClient = kc.makeApiClient(k8s.NetworkingV1Api);
        return withLegacyKubernetesResponses(networkClient);
    }

    getK8sNodeApiClient = () => {
        const kc = this.getKubeConfig()
        const nodeClient = kc.makeApiClient(k8s.NodeV1Api);
        return withLegacyKubernetesResponses(nodeClient);
    }

    getMetricsApiClient = () => {
        return new k8s.Metrics(this.getKubeConfig());
    }

    /**
    * Applies a single Kubernetes resource to the cluster
    * @param kc KubeConfig instance
    * @param spec Resource specification
    */
    public async applyResource(spec: any, namespace: string): Promise<void> {
        if (!spec || !spec.kind) {
            console.error('Invalid resource specification:', spec);
            throw new Error('Invalid resource specification');
        }

        namespace = spec.metadata.namespace || namespace;

        if (!namespace) {
            throw new ServiceException('Namespace is required in resource metadata in method applyResource');
        }

        const name = spec.metadata?.name;

        console.log(`Applying ${spec.kind}/${name} to namespace ${namespace}`);

        try {
            const client = k8s.KubernetesObjectApi.makeApiClient(this.getKubeConfig());

            try {
                await client.read(spec);
                // If it exists, patch it
                await client.patch(spec);
                console.log(`Updated ${spec.kind}/${name}`);
            } catch (error) {
                await client.create(spec);
                console.log(`Created ${spec.kind}/${name}`);
            }
        } catch (error) {
            console.error(`Failed to apply ${spec.kind}/${name}:`, error);
            throw error;
        }
    }
}

const k3s = new K3sApiAdapter();
export default k3s;
