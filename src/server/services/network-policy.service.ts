import { AppExtendedModel } from "@/shared/model/app-extended.model";
import k3s from "../adapter/kubernetes-api.adapter";
import { V1NamespaceList, V1NetworkPolicy, V1NetworkPolicyList } from "@kubernetes/client-node";
import { KubeObjectNameUtils } from "../utils/kube-object-name.utils";
import { Constants } from "../../shared/utils/constants";
import { appNetworkPolicy, AppNetworkPolicyType } from "@/shared/model/network-policy.model";

type NetworkPolicyManifest = any;
type NetworkPolicyRule = any;
type NetworkPolicyPeer = any;

class NetworkPolicyService {

    async reconcileNetworkPolicy(app: AppExtendedModel) {
        const policyName = KubeObjectNameUtils.toNetworkPolicyName(app.id);
        const namespace = app.projectId;

        // If network policies are disabled, delete existing policy if any and return
        if (!app.useNetworkPolicy) {
            await this.deleteNetworkPolicy(app.id, app.projectId);
            return;
        }

        const ingressPolicy = this.normalizePolicy(app.ingressNetworkPolicy);
        const egressPolicy = this.normalizePolicy(app.egressNetworkPolicy);

        const policy: NetworkPolicyManifest = {
            apiVersion: "networking.k8s.io/v1",
            kind: "NetworkPolicy",
            metadata: {
                name: policyName,
                namespace: namespace,
                labels: {
                    app: app.id
                },
                annotations: {
                    [Constants.QS_ANNOTATION_APP_ID]: app.id,
                    [Constants.QS_ANNOTATION_PROJECT_ID]: app.projectId,
                }
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        app: app.id
                    }
                },
                policyTypes: ["Ingress", "Egress"],
                ingress: this.getIngressRules(ingressPolicy, app.appNodePorts),
                egress: this.getEgressRules(egressPolicy)
            }
        };
        await this.applyNetworkPolicy(namespace, policyName, policy);
    }

    private normalizePolicy(raw: string): AppNetworkPolicyType {
        const parsed = appNetworkPolicy.safeParse(raw);
        return parsed.success ? parsed.data : 'ALLOW_ALL';
    }

    private getIngressRules(policyType: AppNetworkPolicyType, nodePorts: { port: number; protocol?: string }[] = []): NetworkPolicyRule[] {
        const rules: NetworkPolicyRule[] = [];

        const traefikFrom: NetworkPolicyPeer[] = [
            {
                namespaceSelector: {
                    matchLabels: {
                        'kubernetes.io/metadata.name': 'kube-system'
                    }
                },
                podSelector: {
                    matchLabels: {
                        'app.kubernetes.io/name': 'traefik'
                    }
                }
            },
            /* // Fallback label used in some clusters/charts
             {
                 namespaceSelector: {
                     matchLabels: {
                         'kubernetes.io/metadata.name': 'kube-system'
                     }
                 },
                 podSelector: {
                     matchLabels: {
                         app: 'traefik'
                     }
                 }
             }*/
        ];

        const backupPodFrom: NetworkPolicyPeer[] = [{
            podSelector: {
                matchLabels: {
                    [Constants.QS_ANNOTATION_CONTAINER_TYPE]: Constants.QS_ANNOTATION_CONTAINER_TYPE_DB_BACKUP_JOB
                }
            }
        }];

        const dbToolPod: NetworkPolicyPeer[] = [{
            podSelector: {
                matchLabels: {
                    [Constants.QS_ANNOTATION_CONTAINER_TYPE]: Constants.QS_ANNOTATION_CONTAINER_TYPE_DB_TOOL
                }
            }
        }];

        if (policyType === 'ALLOW_ALL') {
            // Allow from same namespace and from Traefik (internet traffic comes through Traefik)
            rules.push({
                from: [
                    ...traefikFrom,
                    {
                        podSelector: {} // Selects all pods in the same namespace
                    }
                ]
            });
        } else if (policyType === 'INTERNET_ONLY') {
            // Allow from Traefik (internet traffic comes through Traefik) and from DB-backup jobs.
            // Block other internal pod traffic.
            rules.push({
                from: [
                    ...traefikFrom,
                    ...backupPodFrom,
                    ...dbToolPod
                ]
            });
        } else if (policyType === 'NAMESPACE_ONLY') {
            // Allow only from same namespace
            rules.push({
                from: [{
                    podSelector: {} // Selects all pods in the same namespace
                }]
            });
        } else if (policyType === 'DENY_ALL') {
            // No rules means deny all --> except the separate container for database backups
            rules.push({
                from: [
                    ...backupPodFrom,
                    ...dbToolPod
                ]
            });
        }

        if (nodePorts.length > 0) {
            const exposedPorts = nodePorts
                .filter((nodePort, index, self) =>
                    index === self.findIndex(item =>
                        item.port === nodePort.port && (item.protocol || 'TCP') === (nodePort.protocol || 'TCP')))
                .map(nodePort => ({
                    protocol: (nodePort.protocol || 'TCP') as any,
                    port: nodePort.port as any
                }));

            rules.push({
                from: [{
                    ipBlock: {
                        cidr: '0.0.0.0/0'
                    }
                }],
                ports: exposedPorts
            });
        }

        return rules;
    }

    private getEgressRules(policyType: AppNetworkPolicyType): NetworkPolicyRule[] {
        const rules: NetworkPolicyRule[] = [];

        // allow DNS (kube-dns/coredns) on UDP/TCP 53
        const dnsRuleAllow: NetworkPolicyRule = {
            to: [
                {
                    namespaceSelector: {
                        matchLabels: {
                            "kubernetes.io/metadata.name": "kube-system"
                        }
                    },
                    podSelector: {
                        matchLabels: {
                            "k8s-app": "kube-dns"
                        }
                    }
                },
                {
                    namespaceSelector: {
                        matchLabels: {
                            "kubernetes.io/metadata.name": "kube-system"
                        }
                    },
                    podSelector: {
                        matchLabels: {
                            "k8s-app": "coredns"
                        }
                    }
                }
            ],
            ports: [
                { protocol: 'UDP', port: 53 as any },
                { protocol: 'TCP', port: 53 as any }
            ]
        };

        if (policyType === 'ALLOW_ALL') {
            // Allow Internet + Local Namespace, Block other namespaces (Private IPs)
            rules.push(dnsRuleAllow);
            rules.push({
                to: [
                    {
                        ipBlock: {
                            cidr: '0.0.0.0/0',
                            except: [
                                '10.0.0.0/8',
                                '172.16.0.0/12',
                                '192.168.0.0/16'
                            ]
                        }
                    },
                    {
                        podSelector: {} // Allow all in same namespace
                    }
                ]
            });
        } else if (policyType === 'INTERNET_ONLY') {
            // Allow only to internet, block internal cluster traffic
            rules.push(dnsRuleAllow);
            rules.push({
                to: [{
                    ipBlock: {
                        cidr: '0.0.0.0/0',
                        except: [
                            '10.0.0.0/8',
                            '172.16.0.0/12',
                            '192.168.0.0/16'
                        ]
                    }
                }]
            });
        } else if (policyType === 'NAMESPACE_ONLY') {
            // Allow only to same namespace
            rules.push(dnsRuleAllow);
            rules.push({
                to: [{
                    podSelector: {}
                }]
            });
        } else if (policyType === 'DENY_ALL') {
            // Allow completely nothing
        }

        return rules;
    }

    async deleteNetworkPolicy(appId: string, projectId: string) {
        const policyName = KubeObjectNameUtils.toNetworkPolicyName(appId);
        const existingNetworkPolicy = await this.getExistingNetworkPolicy(projectId, policyName);
        if (!existingNetworkPolicy) {
            return;
        }
        await k3s.network.deleteNamespacedNetworkPolicy(policyName, projectId);
    }

    private async applyNetworkPolicy(namespace: string, policyName: string, body: NetworkPolicyManifest) {
        const existing = await this.getExistingNetworkPolicy(namespace, policyName);
        if (existing) {
            await k3s.network.replaceNamespacedNetworkPolicy(policyName, namespace, body);
        } else {
            await k3s.network.createNamespacedNetworkPolicy(namespace, body);
        }
    }

    private async getExistingNetworkPolicy(namespace: string, policyName: string): Promise<V1NetworkPolicy | undefined> {
        const allPolicies = await k3s.network.listNamespacedNetworkPolicy(namespace) as { body: V1NetworkPolicyList };
        return allPolicies.body.items.find(np => np.metadata?.name === policyName);
    }

    async reconcileDbToolNetworkPolicy(dbToolAppName: string, dbAppId: string, projectId: string) {
        const policyName = KubeObjectNameUtils.toNetworkPolicyName(dbToolAppName);
        const namespace = projectId;

        const policy: NetworkPolicyManifest = {
            apiVersion: "networking.k8s.io/v1",
            kind: "NetworkPolicy",
            metadata: {
                name: policyName,
                namespace: namespace,
                labels: {
                    app: dbToolAppName,
                    'db-tool': 'true'
                },
                annotations: {
                    [Constants.QS_ANNOTATION_APP_ID]: dbAppId,
                    [Constants.QS_ANNOTATION_PROJECT_ID]: projectId,
                }
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        app: dbToolAppName
                    }
                },
                policyTypes: ["Ingress", "Egress"],
                ingress: [
                    {
                        // Allow from Traefik (internet traffic)
                        from: [
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        'kubernetes.io/metadata.name': 'kube-system'
                                    }
                                },
                                podSelector: {
                                    matchLabels: {
                                        'app.kubernetes.io/name': 'traefik'
                                    }
                                }
                            }
                        ]
                    }
                ],
                egress: [
                    {
                        // Allow DNS
                        to: [
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        "kubernetes.io/metadata.name": "kube-system"
                                    }
                                },
                                podSelector: {
                                    matchLabels: {
                                        "k8s-app": "kube-dns"
                                    }
                                }
                            },
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        "kubernetes.io/metadata.name": "kube-system"
                                    }
                                },
                                podSelector: {
                                    matchLabels: {
                                        "k8s-app": "coredns"
                                    }
                                }
                            }
                        ],
                        ports: [
                            { protocol: 'UDP', port: 53 as any },
                            { protocol: 'TCP', port: 53 as any }
                        ]
                    },
                    {
                        // Allow only to database pod in same namespace
                        to: [
                            {
                                podSelector: {
                                    matchLabels: {
                                        app: dbAppId
                                    }
                                }
                            }
                        ]
                    }
                ]
            }
        };
        console.log('Creating DB Tool Network Policy:', JSON.stringify(policy, null, 2));
        await this.applyNetworkPolicy(namespace, policyName, policy);
    }

    async deleteDbToolNetworkPolicy(dbToolAppName: string, projectId: string) {
        const policyName = KubeObjectNameUtils.toNetworkPolicyName(dbToolAppName);
        const existingNetworkPolicy = await this.getExistingNetworkPolicy(projectId, policyName);
        if (!existingNetworkPolicy) {
            return;
        }
        await k3s.network.deleteNamespacedNetworkPolicy(policyName, projectId);
    }

    async reconcileFileBrowserNetworkPolicy(fileBrowserAppName: string, projectId: string) {
        const policyName = KubeObjectNameUtils.toNetworkPolicyName(fileBrowserAppName);
        const namespace = projectId;

        const policy: NetworkPolicyManifest = {
            apiVersion: "networking.k8s.io/v1",
            kind: "NetworkPolicy",
            metadata: {
                name: policyName,
                namespace: namespace,
                labels: {
                    app: fileBrowserAppName,
                    'file-browser': 'true'
                },
                annotations: {
                    [Constants.QS_ANNOTATION_PROJECT_ID]: projectId,
                }
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        app: fileBrowserAppName
                    }
                },
                policyTypes: ["Ingress", "Egress"],
                ingress: [
                    {
                        // Allow from Traefik (internet traffic)
                        from: [
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        'kubernetes.io/metadata.name': 'kube-system'
                                    }
                                },
                                podSelector: {
                                    matchLabels: {
                                        'app.kubernetes.io/name': 'traefik'
                                    }
                                }
                            }
                        ]
                    }
                ],
                egress: [] // Deny all outgoing traffic
            }
        };
        console.log('Creating FileBrowser Network Policy:', JSON.stringify(policy, null, 2));
        await this.applyNetworkPolicy(namespace, policyName, policy);
    }

    async deleteFileBrowserNetworkPolicy(fileBrowserAppName: string, projectId: string) {
        const policyName = KubeObjectNameUtils.toNetworkPolicyName(fileBrowserAppName);
        const existingNetworkPolicy = await this.getExistingNetworkPolicy(projectId, policyName);
        if (!existingNetworkPolicy) {
            return;
        }
        await k3s.network.deleteNamespacedNetworkPolicy(policyName, projectId);
    }

    async deleteAllNetworkPolicies() {
        const namespaces = await k3s.core.listNamespace() as { body: V1NamespaceList };
        let deletedCount = 0;

        for (const ns of namespaces.body.items) {
            const namespace = ns.metadata?.name;
            if (!namespace) continue;

            try {
                const policies = await k3s.network.listNamespacedNetworkPolicy(namespace) as { body: V1NetworkPolicyList };
                for (const policy of policies.body.items) {
                    const policyName = policy.metadata?.name;
                    if (policyName) {
                        await k3s.network.deleteNamespacedNetworkPolicy(policyName, namespace);
                        deletedCount++;
                    }
                }
            } catch (error) {
                console.error(`Error deleting network policies in namespace ${namespace}:`, error);
            }
        }

        return deletedCount;
    }
}

const networkPolicyService = new NetworkPolicyService();
export default networkPolicyService;


