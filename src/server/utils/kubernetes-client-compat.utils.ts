type KubernetesApiMethodArgs = unknown[];

export type KubernetesListResponse<T> = { items: T[] } | { body: { items: T[] } };

type LegacyCall = {
    params: Record<string, unknown>;
    options?: unknown;
};

const LIST_PARAMS = ['pretty', 'allowWatchBookmarks', '_continue', 'fieldSelector', 'labelSelector', 'limit', 'resourceVersion', 'resourceVersionMatch', 'sendInitialEvents', 'timeoutSeconds', 'watch'];
const MUTATION_PARAMS = ['pretty', 'dryRun', 'fieldManager', 'fieldValidation'];
const DELETE_PARAMS = ['pretty', 'dryRun', 'gracePeriodSeconds', 'orphanDependents', 'propagationPolicy', 'body'];
const PATCH_PARAMS = ['pretty', 'dryRun', 'fieldManager', 'fieldValidation', 'force'];
const CUSTOM_OBJECT_LIST_PARAMS = LIST_PARAMS.filter(name => name !== 'sendInitialEvents');

export function getKubernetesListItems<T>(response: KubernetesListResponse<T>): T[] {
    return 'body' in response ? response.body.items : response.items;
}

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
        mapOptionalParams(params, CUSTOM_OBJECT_LIST_PARAMS, rest);
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
        mapOptionalParams(params, CUSTOM_OBJECT_LIST_PARAMS, rest);
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

export function withLegacyKubernetesResponses<T extends object>(client: T): T {
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
