import { AppPublicEndpoint, Prisma } from "@prisma/client";
import k3s from "../adapter/kubernetes-api.adapter";
import dataAccess from "../adapter/db.client";
import appService from "./app.service";
import namespaceService from "./namespace.service";
import networkPolicyService from "./network-policy.service";
import { AppExtendedModel } from "@/shared/model/app-extended.model";
import { parseSourceCidrsJson, PUBLIC_ENDPOINT_GATEWAY_LABEL, PUBLIC_ENDPOINT_NAMESPACE } from "@/shared/model/public-endpoint.model";
import { KubeObjectNameUtils } from "../utils/kube-object-name.utils";

const HAPROXY_IMAGE = 'haproxy:2.9-alpine';

type EndpointWithApp = AppPublicEndpoint & {
    app: {
        id: string;
        name: string;
        projectId: string;
    };
};

class PublicEndpointService {
    async saveAndReconcileForApp(input: Prisma.AppPublicEndpointUncheckedCreateInput | Prisma.AppPublicEndpointUncheckedUpdateInput) {
        const saved = await appService.savePublicEndpoint(input);
        const app = await appService.getExtendedById(saved.appId, false);
        await networkPolicyService.reconcileNetworkPolicy(app);
        await this.reconcileGatewayForIp(saved.publicIp);
        const refreshed = await appService.getExtendedById(saved.appId, false);
        return refreshed.appPublicEndpoints.find(endpoint => endpoint.id === saved.id) ?? saved;
    }

    async deleteAndReconcileForApp(endpointId: string) {
        const endpoint = await appService.getPublicEndpointById(endpointId);
        await appService.deletePublicEndpointById(endpoint.id);
        const app = await appService.getExtendedById(endpoint.appId, false);
        await networkPolicyService.reconcileNetworkPolicy(app);
        await this.reconcileGatewayForIp(endpoint.publicIp);
        return endpoint;
    }

    async reconcileForApp(app: AppExtendedModel) {
        const impactedIps = new Set((app.appPublicEndpoints ?? []).map(endpoint => endpoint.publicIp));
        for (const publicIp of impactedIps) {
            await this.reconcileGatewayForIp(publicIp);
        }
    }

    async reconcileGatewayForIp(publicIp: string) {
        await namespaceService.createNamespaceIfNotExists(PUBLIC_ENDPOINT_NAMESPACE);
        const endpoints = await dataAccess.client.appPublicEndpoint.findMany({
            where: {
                publicIp,
                enabled: true,
                protocol: 'TCP',
            },
            include: {
                app: {
                    select: {
                        id: true,
                        name: true,
                        projectId: true,
                    }
                }
            },
            orderBy: [
                { publicPort: 'asc' },
                { targetPort: 'asc' },
            ]
        }) as EndpointWithApp[];

        if (endpoints.length === 0) {
            await this.deleteGateway(publicIp);
            return;
        }

        const configName = this.gatewayName(publicIp);
        const config = this.renderHaproxyConfig(endpoints);
        await this.applyConfigMap(configName, config);
        await this.applyGatewayDeployment(publicIp, configName, endpoints);
        await dataAccess.client.appPublicEndpoint.updateMany({
            where: {
                publicIp,
                id: { in: endpoints.map(endpoint => endpoint.id) },
            },
            data: {
                status: 'ACTIVE',
                lastError: null,
            },
        });
    }

    private renderHaproxyConfig(endpoints: EndpointWithApp[]) {
        const sections = [
            'global',
            '    log stdout format raw local0',
            '    maxconn 4096',
            '',
            'defaults',
            '    mode tcp',
            '    log global',
            '    option tcplog',
            '    timeout connect 10s',
            '    timeout client 1m',
            '    timeout server 1m',
            '',
        ];

        for (const endpoint of endpoints) {
            const name = this.endpointName(endpoint);
            const allowedCidrs = parseSourceCidrsJson(endpoint.sourceCidrsJson);
            sections.push(`frontend ${name}`);
            sections.push(`    bind ${endpoint.publicIp}:${endpoint.publicPort}`);
            if (allowedCidrs.length > 0) {
                sections.push(`    acl source_allowed src ${allowedCidrs.join(' ')}`);
                sections.push('    tcp-request connection reject if !source_allowed');
            }
            sections.push(`    default_backend ${name}_backend`);
            sections.push('');
            sections.push(`backend ${name}_backend`);
            sections.push(`    server app ${KubeObjectNameUtils.toServiceName(endpoint.app.id)}.${endpoint.app.projectId}.svc.cluster.local:${endpoint.targetPort} check${endpoint.proxyProtocol ? ' send-proxy' : ''}`);
            sections.push('');
        }

        return `${sections.join('\n')}\n`;
    }

    private async applyConfigMap(name: string, config: string) {
        const body = {
            metadata: {
                name,
                namespace: PUBLIC_ENDPOINT_NAMESPACE,
                labels: {
                    'app.kubernetes.io/name': PUBLIC_ENDPOINT_GATEWAY_LABEL,
                },
            },
            data: {
                'haproxy.cfg': config,
            },
        };
        const existing = await this.configMapExists(name);
        if (existing) {
            await k3s.core.replaceNamespacedConfigMap(name, PUBLIC_ENDPOINT_NAMESPACE, body as any);
        } else {
            await k3s.core.createNamespacedConfigMap(PUBLIC_ENDPOINT_NAMESPACE, body as any);
        }
    }

    private async applyGatewayDeployment(publicIp: string, configName: string, endpoints: EndpointWithApp[]) {
        const name = this.gatewayName(publicIp);
        const ports = endpoints.map(endpoint => ({
            name: `p-${endpoint.publicPort}`.slice(0, 15),
            containerPort: endpoint.publicPort,
            protocol: endpoint.protocol as any,
            hostPort: endpoint.publicPort,
        }));
        const body = {
            metadata: {
                name,
                namespace: PUBLIC_ENDPOINT_NAMESPACE,
                labels: {
                    app: name,
                    'app.kubernetes.io/name': PUBLIC_ENDPOINT_GATEWAY_LABEL,
                    'quickstack.io/public-ip': publicIp,
                },
            },
            spec: {
                replicas: 1,
                strategy: {
                    type: 'Recreate',
                },
                selector: {
                    matchLabels: {
                        app: name,
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            app: name,
                            'app.kubernetes.io/name': PUBLIC_ENDPOINT_GATEWAY_LABEL,
                            'quickstack.io/public-ip': publicIp,
                        },
                        annotations: {
                            configHash: this.hashConfig(endpoints),
                        },
                    },
                    spec: {
                        hostNetwork: true,
                        dnsPolicy: 'ClusterFirstWithHostNet',
                        containers: [{
                            name: 'gateway',
                            image: HAPROXY_IMAGE,
                            args: ['-f', '/usr/local/etc/haproxy/haproxy.cfg'],
                            ports,
                            volumeMounts: [{
                                name: 'config',
                                mountPath: '/usr/local/etc/haproxy',
                                readOnly: true,
                            }],
                            readinessProbe: {
                                exec: {
                                    command: ['sh', '-c', 'pidof haproxy >/dev/null && haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg >/dev/null'],
                                },
                                initialDelaySeconds: 2,
                                periodSeconds: 10,
                            },
                        }],
                        volumes: [{
                            name: 'config',
                            configMap: {
                                name: configName,
                            },
                        }],
                    },
                },
            },
        };
        const existing = await this.deploymentExists(name);
        if (existing) {
            await k3s.apps.replaceNamespacedDeployment(name, PUBLIC_ENDPOINT_NAMESPACE, body as any);
        } else {
            await k3s.apps.createNamespacedDeployment(PUBLIC_ENDPOINT_NAMESPACE, body as any);
        }
    }

    private async deleteGateway(publicIp: string) {
        const name = this.gatewayName(publicIp);
        if (await this.deploymentExists(name)) {
            await k3s.apps.deleteNamespacedDeployment(name, PUBLIC_ENDPOINT_NAMESPACE);
        }
        if (await this.configMapExists(name)) {
            await k3s.core.deleteNamespacedConfigMap(name, PUBLIC_ENDPOINT_NAMESPACE);
        }
    }

    private async deploymentExists(name: string) {
        try {
            await k3s.apps.readNamespacedDeployment(name, PUBLIC_ENDPOINT_NAMESPACE);
            return true;
        } catch {
            return false;
        }
    }

    private async configMapExists(name: string) {
        try {
            await k3s.core.readNamespacedConfigMap(name, PUBLIC_ENDPOINT_NAMESPACE);
            return true;
        } catch {
            return false;
        }
    }

    private gatewayName(publicIp: string) {
        return `qs-endpoint-${publicIp.replace(/\./g, '-')}`;
    }

    private endpointName(endpoint: EndpointWithApp) {
        return `ep_${endpoint.id.replace(/-/g, '_')}`;
    }

    private hashConfig(endpoints: EndpointWithApp[]) {
        const source = endpoints.map(endpoint => `${endpoint.id}:${endpoint.publicIp}:${endpoint.publicPort}:${endpoint.targetPort}:${endpoint.sourceCidrsJson ?? ''}:${endpoint.proxyProtocol}`).join('|');
        let hash = 0;
        for (let index = 0; index < source.length; index++) {
            hash = ((hash << 5) - hash) + source.charCodeAt(index);
            hash |= 0;
        }
        return String(hash);
    }
}

const publicEndpointService = new PublicEndpointService();
export default publicEndpointService;
