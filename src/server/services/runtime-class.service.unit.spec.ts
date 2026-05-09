const k3sMocks = vi.hoisted(() => ({
    listRuntimeClass: vi.fn(),
    readRuntimeClass: vi.fn(),
    listNode: vi.fn(),
    createNamespacedPod: vi.fn(),
    readNamespacedPod: vi.fn(),
    deleteNamespacedPod: vi.fn(),
    getKubeConfig: vi.fn(),
}));

const namespaceMocks = vi.hoisted(() => ({
    createNamespaceIfNotExists: vi.fn(),
}));

const execMocks = vi.hoisted(() => ({
    exec: vi.fn(),
}));

vi.mock('@kubernetes/client-node', () => ({
    Exec: vi.fn().mockImplementation(function Exec() {
        return { exec: execMocks.exec };
    }),
}));

vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({
    default: {
        node: {
            listRuntimeClass: k3sMocks.listRuntimeClass,
            readRuntimeClass: k3sMocks.readRuntimeClass,
        },
        core: {
            listNode: k3sMocks.listNode,
            createNamespacedPod: k3sMocks.createNamespacedPod,
            readNamespacedPod: k3sMocks.readNamespacedPod,
            deleteNamespacedPod: k3sMocks.deleteNamespacedPod,
        },
        getKubeConfig: k3sMocks.getKubeConfig,
    },
}));

vi.mock('@/server/services/namespace.service', () => ({
    default: {
        createNamespaceIfNotExists: namespaceMocks.createNamespaceIfNotExists,
    },
}));

import runtimeClassService from './runtime-class.service';

function runtimeClass(name = 'kata', handler = 'kata') {
    return {
        metadata: { name },
        handler,
        scheduling: {
            nodeSelector: { 'quickstack.io/kata-runtime': 'true' },
        },
    };
}

function readyNode(name: string, labels = { 'quickstack.io/kata-runtime': 'true' }) {
    return {
        metadata: { name, labels },
        status: { conditions: [{ type: 'Ready', status: 'True' }] },
    };
}

describe('runtime-class.service Kata health', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        k3sMocks.readRuntimeClass.mockResolvedValue({ body: runtimeClass() });
        k3sMocks.listRuntimeClass.mockResolvedValue({ body: { items: [runtimeClass()] } });
        k3sMocks.listNode.mockResolvedValue({ body: { items: [readyNode('node-1'), readyNode('node-2')] } });
        k3sMocks.createNamespacedPod.mockResolvedValue({ body: {} });
        k3sMocks.readNamespacedPod.mockResolvedValue({ body: { status: { phase: 'Running' } } });
        k3sMocks.deleteNamespacedPod.mockResolvedValue({ body: {} });
        execMocks.exec.mockImplementation((_namespace, _podName, _container, _command, stdout, _stderr, _stdin, _tty, callback) => {
            stdout.write('product_name=Kata Containers\nsys_vendor=QEMU\ncgroup=kata-runtime\n');
            callback({ status: 'Success' });
            return Promise.resolve();
        });
    });

    it('probes every eligible Ready node and returns Kata runtime evidence', async () => {
        const health = await runtimeClassService.assertRuntimeClassHealthy('kata');

        expect(health.healthy).toBe(true);
        expect(health.nodes).toHaveLength(2);
        expect(namespaceMocks.createNamespaceIfNotExists).toHaveBeenCalledWith('quickstack-runtime-probes');
        expect(k3sMocks.createNamespacedPod).toHaveBeenCalledTimes(2);
        expect(k3sMocks.createNamespacedPod.mock.calls[0][1].spec).toEqual(expect.objectContaining({
            runtimeClassName: 'kata',
            nodeName: 'node-1',
        }));
        expect(k3sMocks.createNamespacedPod.mock.calls[1][1].spec).toEqual(expect.objectContaining({
            runtimeClassName: 'kata',
            nodeName: 'node-2',
        }));
        expect(health.runtimeProof).toContain('QEMU');
        expect(health.runtimeProof).toContain('kata-runtime');
    });

    it('fails closed when the probe pod runs without Kata-specific evidence', async () => {
        k3sMocks.readRuntimeClass.mockResolvedValue({ body: runtimeClass('kata-fail', 'kata') });
        execMocks.exec.mockImplementation((_namespace, _podName, _container, _command, stdout, _stderr, _stdin, _tty, callback) => {
            stdout.write('product_name=Standard PC\nsys_vendor=Generic\ncgroup=/\n');
            callback({ status: 'Success' });
            return Promise.resolve();
        });

        await expect(runtimeClassService.probeKataRuntimeClass('kata-fail')).resolves.toMatchObject({
            healthy: false,
            message: expect.stringContaining('failed the Kata/QEMU probe'),
        });
        await expect(runtimeClassService.assertRuntimeClassHealthy('kata-fail')).rejects.toThrow('failed the Kata/QEMU probe');
    });

    it('treats non-Kata RuntimeClasses as existence checks only', async () => {
        k3sMocks.readRuntimeClass.mockResolvedValue({ body: runtimeClass('gvisor', 'runsc') });

        const health = await runtimeClassService.assertRuntimeClassHealthy('gvisor');

        expect(health.healthy).toBe(true);
        expect(health.nodes).toEqual([]);
        expect(k3sMocks.createNamespacedPod).not.toHaveBeenCalled();
    });
});
