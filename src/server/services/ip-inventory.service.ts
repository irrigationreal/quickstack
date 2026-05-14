import appService from "./app.service";
import paramService, { ParamService } from "./param.service";

class IpInventoryService {
    async listForApp(appId: string) {
        const app = await appService.getExtendedById(appId, false);
        const configuredPublicIp = await paramService.getStringUncached(ParamService.PUBLIC_IPV4_ADDRESS).catch(() => undefined);
        const rawEndpointIps = app.appPublicEndpoints.map(endpoint => ({
            address: endpoint.publicIp,
            kind: 'public-endpoint' as const,
            endpointId: endpoint.id,
            publicPort: endpoint.publicPort,
            targetPort: endpoint.targetPort,
            protocol: endpoint.protocol,
        }));
        const ingressIps = configuredPublicIp && app.appDomains.length > 0 ? [{
            address: configuredPublicIp,
            kind: 'ingress' as const,
            domains: app.appDomains.map(domain => domain.hostname),
        }] : [];
        return { app, ips: [...ingressIps, ...rawEndpointIps] };
    }
}

const ipInventoryService = new IpInventoryService();
export default ipInventoryService;
