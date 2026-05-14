import k3s from "../adapter/kubernetes-api.adapter";
import type { AppDomain } from "@prisma/client";
import type { CertState } from "@/shared/model/agent-domain.model";

class CertificateService {
    async getDomainCertState(projectId: string, domain: Pick<AppDomain, 'id' | 'useSsl'>): Promise<CertState> {
        if (!domain.useSsl) {
            return { status: 'issued', issuer: 'http-only', message: 'TLS is disabled for this domain.' };
        }
        try {
            const secret = await k3s.core.readNamespacedSecret(`secret-tls-${domain.id}`, projectId);
            const cert = secret.body?.data?.['tls.crt'];
            if (cert) {
                return { status: 'issued', issuer: 'letsencrypt-production' };
            }
            return { status: 'pending', issuer: 'letsencrypt-production' };
        } catch (error: any) {
            const status = error?.response?.statusCode ?? error?.response?.status ?? error?.statusCode ?? error?.status;
            if (status === 404) {
                return { status: 'pending', issuer: 'letsencrypt-production' };
            }
            return { status: 'failed', issuer: 'letsencrypt-production', message: error instanceof Error ? error.message : 'Unable to read certificate state.' };
        }
    }
}

const certificateService = new CertificateService();
export default certificateService;
