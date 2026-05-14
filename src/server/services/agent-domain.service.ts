import crypto from "crypto";
import appService from "./app.service";
import paramService, { ParamService } from "./param.service";
import { HostnameDnsProviderUtils } from "@/shared/utils/domain-dns-provider.utils";
import ingressService from "./ingress.service";
import certificateService from "./certificate.service";

function slugify(value: string) {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-')
        .slice(0, 32);
    return slug || 'app';
}

function parentDomain(hostname: string | undefined) {
    const parts = hostname?.split('.').filter(Boolean) ?? [];
    if (parts.length >= 3) {
        return parts.slice(1).join('.');
    }
    return undefined;
}

class AgentDomainService {
    async getGeneratedAppDomainSuffix() {
        const configuredSuffix = await paramService.getStringUncached(ParamService.GENERATED_APP_DOMAIN_SUFFIX);
        if (configuredSuffix) {
            return configuredSuffix;
        }

        const serverHostname = await paramService.getStringUncached(ParamService.QS_SERVER_HOSTNAME);
        return parentDomain(serverHostname) ?? HostnameDnsProviderUtils.PROVIDER_HOSTNAME;
    }

    async generateHostname(prefix: string) {
        const domainSuffix = await this.getGeneratedAppDomainSuffix();
        for (let attempt = 0; attempt < 5; attempt++) {
            const suffix = crypto.randomBytes(3).toString('hex');
            const hostname = `${slugify(prefix)}-${suffix}.${domainSuffix}`;
            const existing = await appService.getDomainByHostname(hostname).catch(() => null);
            if (!existing) {
                return hostname;
            }
        }
        const fallback = crypto.randomBytes(8).toString('hex');
        return `${slugify(prefix)}-${fallback}.${domainSuffix}`;
    }

    async list(appId: string) {
        const app = await appService.getExtendedById(appId, false);
        const domains = await Promise.all(app.appDomains.map(async (domain, index) => ({
            id: domain.id,
            hostname: domain.hostname,
            port: domain.port,
            useSsl: domain.useSsl,
            isPrimary: index === 0,
            certState: await certificateService.getDomainCertState(app.projectId, domain),
        })));
        return { app, domains };
    }

    async add(appId: string, input: { hostname: string; port?: number; useSsl?: boolean; redirectHttps?: boolean }) {
        const app = await appService.getExtendedById(appId, false);
        const hostname = new URL(input.hostname.includes('://') ? input.hostname : `https://${input.hostname}`).hostname;
        const saved = await appService.saveDomain({
            appId: app.id,
            hostname,
            port: input.port ?? app.appPorts[0]?.port ?? 80,
            useSsl: input.useSsl ?? true,
            redirectHttps: input.redirectHttps ?? true,
        });
        const updated = await appService.getExtendedById(app.id, false);
        await ingressService.createOrUpdateIngressForApp(`domain-${saved.id}`, updated);
        return (await this.list(app.id)).domains.find(domain => domain.id === saved.id)!;
    }

    async remove(appId: string, hostnameOrId: string) {
        const app = await appService.getExtendedById(appId, false);
        const domain = app.appDomains.find(item => item.id === hostnameOrId || item.hostname === hostnameOrId);
        if (!domain) {
            return null;
        }
        await appService.deleteDomainById(domain.id);
        const updated = await appService.getExtendedById(app.id, false).catch(() => null);
        if (updated) {
            await ingressService.createOrUpdateIngressForApp(`domain-delete-${domain.id}`, updated);
        }
        return { id: domain.id, hostname: domain.hostname };
    }
}

const agentDomainService = new AgentDomainService();
export default agentDomainService;
