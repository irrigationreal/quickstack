import crypto from "crypto";
import appService from "./app.service";
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

class AgentDomainService {
    async generateHostname(prefix: string) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const suffix = crypto.randomBytes(3).toString('hex');
            const hostname = `${slugify(prefix)}-${suffix}.${HostnameDnsProviderUtils.PROVIDER_HOSTNAME}`;
            const existing = await appService.getDomainByHostname(hostname).catch(() => null);
            if (!existing) {
                return hostname;
            }
        }
        const fallback = crypto.randomBytes(8).toString('hex');
        return `${slugify(prefix)}-${fallback}.${HostnameDnsProviderUtils.PROVIDER_HOSTNAME}`;
    }
}

const agentDomainService = new AgentDomainService();
export default agentDomainService;
