import { ServiceException } from '@/shared/model/service.exception.model';
import * as k8s from '@kubernetes/client-node';

type KubernetesApiMethodArgs = unknown[];

type LegacyCall = {
    params: Record<string, unknown>;
    options?: unknown;
};

const LIST_PARAMS = ['pretty', 'allowWatchBookmarks', '_continue', 'fieldSelector', 'labelSelector', 'limit', 'resourceVersion', 'resourceVersionMatch', 'sendInitialEvents', 'timeoutSeconds', 'watch'];
const MUTATION_PARAMS = ['pretty', 'dryRun', 'fieldManager', 'fieldValidation'];
const DELETE_PARAMS = ['pretty', 'dryRun', 'gracePeriodSeconds', 'orphanDependents', 'propagationPolicy', 'body'];
const PATCH_PARAMS = ['pretty', 'dryRun', 'fieldManager', 'fieldValidation', 'force'];

function isObjectParamCall(args: KubernetesApiMethodArgs) {
    if (args.length === 0 || typeof args[0] !== 'object' || args[0] === null || Array.isArray(args[0])) {
        return false;
    }

    return ['namespace', 'name', 'body', 'group', 'version', 'plural', 'pretty', 'fieldSelector', 'labelSelector']
        .some((key) => key in (args[0] as Record<string, unknown>));
}

function mapOptionalParams(params: Record<string, unknown>, names: string[], values: KubernetesApiMethodArgs) {
    names.forEach((name, index) => {
        if (values[index] !== undefined) {
            params[name] = values[index];
        }
    });
}

function splitOptions(values: KubernetesApiMethodArgs) {
    const lastValue = values[values.length - 1];
    if (lastValue && typeof lastValue === 'object' && !Array.isArray(lastValue) && ('headers' in lastValue || 'middleware' in lastValue)) {
        return {
            values: values.slice(0, -1),
            options: lastValue,
        };
    }
    return { values };
}

function mapLegacyKubernetesArgs(methodName: string, args: KubernetesApiMethodArgs): LegacyCall | null {
    const { values, options } = splitOptions(args);

    if (methodName.startsWith('listNamespacedCustomObject')) {
        const [group, version, namespace, plural, ...rest] = values;
        const params = { group, version, namespace, plural } as Record<string, unknown>;
        mapOptionalParams(params, LIST_PARAMS.filter(name => name !== 'sendInitialEvents'), rest);
        return { params, options };
    }

    if (methodName.startsWith('createNamespacedCustomObject')) {
        const [group, version, namespace, plural, body, ...rest] = values;
        const params = { group, version, namespace, plural, body } as Record<string, unknown>;
        mapOptionalParams(params, MUTATION_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('deleteNamespacedCustomObject')) {
        const [group, version, namespace, plural, name, ...rest] = values;
        const params = { group, version, namespace, plural, name } as Record<string, unknown>;
        mapOptionalParams(params, DELETE_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('getNamespacedCustomObject')) {
        const [group, version, namespace, plural, name] = values;
        return { params: { group, version, namespace, plural, name }, options };
    }

    if (methodName.startsWith('listClusterCustomObject')) {
        const [group, version, plural, ...rest] = values;
        const params = { group, version, plural } as Record<string, unknown>;
        mapOptionalParams(params, LIST_PARAMS.filter(name => name !== 'sendInitialEvents'), rest);
        return { params, options };
    }

    if (methodName.startsWith('createClusterCustomObject')) {
        const [group, version, plural, body, ...rest] = values;
        const params = { group, version, plural, body } as Record<string, unknown>;
        mapOptionalParams(params, MUTATION_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('deleteClusterCustomObject')) {
        const [group, version, plural, name, ...rest] = values;
        const params = { group, version, plural, name } as Record<string, unknown>;
        mapOptionalParams(params, DELETE_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('getClusterCustomObject')) {
        const [group, version, plural, name] = values;
        return { params: { group, version, plural, name }, options };
    }

    if (methodName.startsWith('listNamespaced')) {
        const [namespace, ...rest] = values;
        const params = { namespace } as Record<string, unknown>;
        mapOptionalParams(params, LIST_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('createNamespaced')) {
        const [namespace, body, ...rest] = values;
        const params = { namespace, body } as Record<string, unknown>;
        mapOptionalParams(params, MUTATION_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('replaceNamespaced')) {
        const [name, namespace, body, ...rest] = values;
        const params = { name, namespace, body } as Record<string, unknown>;
        mapOptionalParams(params, MUTATION_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('patchNamespaced')) {
        const [name, namespace, body, ...rest] = values;
        const params = { name, namespace, body } as Record<string, unknown>;
        mapOptionalParams(params, PATCH_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('deleteNamespaced')) {
        const [name, namespace, ...rest] = values;
        const params = { name, namespace } as Record<string, unknown>;
        mapOptionalParams(params, DELETE_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('readNamespaced')) {
        const [name, namespace, pretty] = values;
        return { params: { name, namespace, pretty }, options };
    }

    if (methodName.startsWith('list') && methodName.endsWith('ForAllNamespaces')) {
        const params = {} as Record<string, unknown>;
        mapOptionalParams(params, LIST_PARAMS, values);
        return { params, options };
    }

    if (methodName.startsWith('list')) {
        const params = {} as Record<string, unknown>;
        mapOptionalParams(params, LIST_PARAMS, values);
        return { params, options };
    }

    if (methodName.startsWith('read')) {
        const [name, pretty] = values;
        return { params: { name, pretty }, options };
    }

    if (methodName.startsWith('create')) {
        const [body, ...rest] = values;
        const params = { body } as Record<string, unknown>;
        mapOptionalParams(params, MUTATION_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('patch')) {
        const [name, body, ...rest] = values;
        const params = { name, body } as Record<string, unknown>;
        mapOptionalParams(params, PATCH_PARAMS, rest);
        return { params, options };
    }

    if (methodName.startsWith('delete')) {
        const [name, ...rest] = values;
        const params = { name } as Record<string, unknown>;
        mapOptionalParams(params, DELETE_PARAMS, rest);
        return { params, options };
    }

    return null;
}

function withLegacyKubernetesResponses<T extends object>(client: T): T {
    return new Proxy(client, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof property !== 'string' || typeof value !== 'function') {
                return value;
            }

            return async (...args: KubernetesApiMethodArgs) => {
                if (isObjectParamCall(args)) {
                    return value.apply(target, args);
                }

                const legacyCall = mapLegacyKubernetesArgs(property, args);
                if (!legacyCall) {
                    return value.apply(target, args);
                }

                const result = await value.call(target, legacyCall.params, legacyCall.options);
                return { body: result };
            };
        }
    });
}

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
