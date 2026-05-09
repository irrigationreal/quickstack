import { V1Node, V1NodeList, V1Pod, V1RuntimeClass, V1RuntimeClassList } from "@kubernetes/client-node";
import * as k8s from "@kubernetes/client-node";
import stream from "stream";
import k3s from "../adapter/kubernetes-api.adapter";
import namespaceService from "./namespace.service";
import { ServiceException } from "@/shared/model/service.exception.model";
import { RuntimeClassHealthModel, RuntimeClassInfoModel, RuntimeClassNodeHealthModel } from "@/shared/model/runtime-class-settings.model";

const RUNTIME_PROBE_NAMESPACE = 'quickstack-runtime-probes';
const RUNTIME_PROBE_IMAGE = 'busybox:1.36.1';
const MAX_HEALTH_AGE_MS = 5 * 60 * 1000;

class RuntimeClassService {
    private healthCache = new Map<string, RuntimeClassHealthModel>();

    async getRuntimeClasses(): Promise<RuntimeClassInfoModel[]> {
        const response = await k3s.node.listRuntimeClass() as { body: V1RuntimeClassList };
        return response.body.items
            .map(runtimeClass => {
                const name = runtimeClass.metadata?.name ?? '';
                return {
                    name,
                    handler: runtimeClass.handler,
                    hasScheduling: !!runtimeClass.scheduling,
                    hasOverhead: !!runtimeClass.overhead,
                    isKata: this.isKataRuntimeClass(name, runtimeClass.handler),
                    health: this.healthCache.get(name) ?? null,
                };
            })
            .filter(runtimeClass => runtimeClass.name.length > 0);
    }

    async assertRuntimeClassExists(runtimeClassName: string): Promise<V1RuntimeClass> {
        try {
            const response = await k3s.node.readRuntimeClass(runtimeClassName) as { body: V1RuntimeClass };
            return response.body;
        } catch (error) {
            console.error(`RuntimeClass ${runtimeClassName} is not available in this cluster.`, error);
            throw new ServiceException(`RuntimeClass "${runtimeClassName}" is not available in this cluster. The RuntimeClass must already exist and its handler must be configured on eligible nodes.`);
        }
    }

    async assertRuntimeClassHealthy(runtimeClassName: string): Promise<RuntimeClassHealthModel> {
        const runtimeClass = await this.assertRuntimeClassExists(runtimeClassName);
        if (!this.isKataRuntimeClass(runtimeClassName, runtimeClass.handler)) {
            return {
                runtimeClassName,
                healthy: true,
                checkedAt: new Date(),
                nodeName: null,
                runtimeProof: null,
                maxAgeSeconds: MAX_HEALTH_AGE_MS / 1000,
                message: `RuntimeClass "${runtimeClassName}" exists and is not treated as Kata-isolated.`,
                nodes: [],
            };
        }

        const health = await this.probeKataRuntimeClass(runtimeClass);
        this.healthCache.set(runtimeClassName, health);
        if (!health.healthy) {
            throw new ServiceException(health.message);
        }
        return health;
    }

    async probeKataRuntimeClass(runtimeClassOrName: V1RuntimeClass | string): Promise<RuntimeClassHealthModel> {
        const runtimeClass = typeof runtimeClassOrName === 'string'
            ? await this.assertRuntimeClassExists(runtimeClassOrName)
            : runtimeClassOrName;
        const runtimeClassName = runtimeClass.metadata?.name ?? (typeof runtimeClassOrName === 'string' ? runtimeClassOrName : '');
        const checkedAt = new Date();

        await namespaceService.createNamespaceIfNotExists(RUNTIME_PROBE_NAMESPACE);
        const nodes = await this.getEligibleNodes(runtimeClass);
        if (nodes.length === 0) {
            return {
                runtimeClassName,
                healthy: false,
                checkedAt,
                nodeName: null,
                runtimeProof: null,
                maxAgeSeconds: MAX_HEALTH_AGE_MS / 1000,
                nodes: [],
                message: `RuntimeClass "${runtimeClassName}" has no Ready eligible nodes for Kata isolation.`,
            };
        }

        const nodeResults: RuntimeClassNodeHealthModel[] = [];
        for (const node of nodes) {
            nodeResults.push(await this.probeKataRuntimeClassOnNode(runtimeClassName, node.metadata?.name ?? 'unknown-node'));
        }

        const failed = nodeResults.filter(result => !result.healthy);
        return {
            runtimeClassName,
            healthy: failed.length === 0,
            checkedAt,
            nodeName: nodeResults[0]?.nodeName ?? null,
            runtimeProof: nodeResults.map(result => `${result.nodeName}: ${result.runtimeProof ?? result.message}`).join('\n'),
            maxAgeSeconds: MAX_HEALTH_AGE_MS / 1000,
            nodes: nodeResults,
            message: failed.length === 0
                ? `RuntimeClass "${runtimeClassName}" passed the Kata/QEMU probe on ${nodeResults.length} eligible node(s).`
                : `RuntimeClass "${runtimeClassName}" failed the Kata/QEMU probe on ${failed.length} eligible node(s): ${failed.map(result => `${result.nodeName}: ${result.message}`).join('; ')}`,
        };
    }

    isKataRuntimeClass(runtimeClassName: string, handler?: string): boolean {
        return /kata/i.test(runtimeClassName) || /kata/i.test(handler ?? '');
    }

    private async getEligibleNodes(runtimeClass: V1RuntimeClass): Promise<V1Node[]> {
        const response = await k3s.core.listNode() as { body: V1NodeList };
        const selector = runtimeClass.scheduling?.nodeSelector ?? {};
        return response.body.items.filter(node => {
            if (node.spec?.unschedulable) return false;
            const ready = node.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True');
            if (!ready) return false;
            return Object.entries(selector).every(([key, value]) => node.metadata?.labels?.[key] === value);
        });
    }

    private async probeKataRuntimeClassOnNode(runtimeClassName: string, nodeName: string): Promise<RuntimeClassNodeHealthModel> {
        const podName = `runtime-probe-${runtimeClassName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${nodeName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${Date.now()}`.slice(0, 63);
        const pod: V1Pod = {
            metadata: {
                name: podName,
                namespace: RUNTIME_PROBE_NAMESPACE,
                labels: {
                    app: 'quickstack-runtime-probe',
                    'quickstack.io/runtime-class': runtimeClassName,
                    'quickstack.io/probe-node': nodeName,
                },
            },
            spec: {
                runtimeClassName,
                nodeName,
                restartPolicy: 'Never',
                containers: [{
                    name: 'probe',
                    image: RUNTIME_PROBE_IMAGE,
                    command: ['sh', '-c', 'sleep 300'],
                }],
            },
        };

        try {
            await k3s.core.createNamespacedPod(RUNTIME_PROBE_NAMESPACE, pod);
            const runningPod = await this.waitForProbePod(podName);
            const runtimeProof = await this.execProbeCommand(podName);
            if (!this.hasKataRuntimeProof(runtimeProof)) {
                return {
                    nodeName,
                    healthy: false,
                    podPhase: runningPod.status?.phase ?? null,
                    runtimeProof,
                    message: 'Probe pod ran, but did not return a Kata-specific runtime marker or QEMU/KVM guest signal.',
                };
            }

            return {
                nodeName,
                healthy: true,
                podPhase: runningPod.status?.phase ?? null,
                runtimeProof,
                message: 'Kata runtime probe passed.',
            };
        } catch (error) {
            return {
                nodeName,
                healthy: false,
                podPhase: null,
                runtimeProof: null,
                message: error instanceof Error ? error.message : 'Unknown RuntimeClass probe failure.',
            };
        } finally {
            await this.deleteProbePodIfExists(podName);
        }
    }

    private async waitForProbePod(podName: string): Promise<V1Pod> {
        const timeout = 60000;
        const interval = 1000;
        const maxTries = timeout / interval;
        for (let tries = 0; tries < maxTries; tries++) {
            const response = await k3s.core.readNamespacedPod(podName, RUNTIME_PROBE_NAMESPACE) as { body: V1Pod };
            const pod = response.body;
            if (pod.status?.phase === 'Running') {
                return pod;
            }
            if (pod.status?.phase === 'Failed' || pod.status?.phase === 'Succeeded') {
                const reason = pod.status?.reason ?? pod.status?.message ?? pod.status?.phase;
                throw new Error(`Probe pod ended before becoming usable: ${reason}`);
            }
            const waitingReason = pod.status?.containerStatuses?.[0]?.state?.waiting?.message ?? pod.status?.containerStatuses?.[0]?.state?.waiting?.reason;
            if (waitingReason && tries > 10) {
                throw new Error(`Probe pod did not start: ${waitingReason}`);
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        throw new Error('Timed out waiting for RuntimeClass probe pod to run.');
    }

    private async execProbeCommand(podName: string): Promise<string> {
        const stdoutStream = new stream.PassThrough();
        const stderrStream = new stream.PassThrough();
        const chunks: Buffer[] = [];
        const errorChunks: Buffer[] = [];
        stdoutStream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stderrStream.on('data', chunk => errorChunks.push(Buffer.from(chunk)));

        await new Promise<void>((resolve, reject) => {
            const exec = new k8s.Exec(k3s.getKubeConfig());
            exec.exec(
                RUNTIME_PROBE_NAMESPACE,
                podName,
                'probe',
                ['sh', '-c', [
                    'printf "product_name="; cat /sys/class/dmi/id/product_name 2>/dev/null || true',
                    'printf "sys_vendor="; cat /sys/class/dmi/id/sys_vendor 2>/dev/null || true',
                    'printf "cgroup="; cat /proc/1/cgroup 2>/dev/null || true',
                    'printf "mountinfo="; cat /proc/1/mountinfo 2>/dev/null | grep -i kata || true',
                    'printf "cpu="; grep -im1 "hypervisor\|kvm" /proc/cpuinfo 2>/dev/null || true',
                ].join('; ')],
                stdoutStream,
                stderrStream,
                null,
                false,
                ({ status }) => {
                    if (status === 'Failure') {
                        reject(new Error(Buffer.concat(errorChunks).toString('utf-8') || 'RuntimeClass probe command failed.'));
                        return;
                    }
                    resolve();
                },
            ).catch(reject);
        });

        return Buffer.concat(chunks).toString('utf-8').trim();
    }

    private hasKataRuntimeProof(runtimeProof: string): boolean {
        const proof = runtimeProof.toLowerCase();
        return proof.includes('kata')
            || proof.includes('cloud hypervisor')
            || proof.includes('firecracker')
            || proof.includes('qemu')
            || proof.includes('kvm')
            || proof.includes('virtual machine');
    }

    private async deleteProbePodIfExists(podName: string) {
        try {
            await k3s.core.deleteNamespacedPod(podName, RUNTIME_PROBE_NAMESPACE);
        } catch {
            // Best-effort cleanup only.
        }
    }
}

const runtimeClassService = new RuntimeClassService();
export default runtimeClassService;
