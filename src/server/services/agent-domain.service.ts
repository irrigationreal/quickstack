import crypto from "crypto";
import appService from "./app.service";
import paramService, { ParamService } from "./param.service";
import { HostnameDnsProviderUtils } from "@/shared/utils/domain-dns-provider.utils";

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
}

const agentDomainService = new AgentDomainService();
export default agentDomainService;
