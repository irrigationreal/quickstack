'use server'

import { AppPortModel, appPortZodModel } from "@/shared/model/default-port.model";
import { appDomainEditZodModel } from "@/shared/model/domain-edit.model";
import { nodePortEditZodModel } from "@/shared/model/node-port-edit.model";
import { parseSourceCidrsText, publicEndpointEditZodModel } from "@/shared/model/public-endpoint.model";
import { SuccessActionResult } from "@/shared/model/server-action-error-return.model";
import appService from "@/server/services/app.service";
import { getAuthUserSession, isAuthorizedWriteForApp, saveFormAction, simpleAction } from "@/server/utils/action-wrapper.utils";
import { z } from "zod";
import { HostnameDnsProviderUtils } from "@/shared/utils/domain-dns-provider.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import paramService, { ParamService } from "@/server/services/param.service";
import publicEndpointService from "@/server/services/public-endpoint.service";
import agentDomainService from "@/server/services/agent-domain.service";

const actionAppDomainEditZodModel = appDomainEditZodModel.merge(z.object({
    appId: z.string(),
    id: z.string().nullish()
}));

export const saveDomain = async (prevState: any, inputData: z.infer<typeof actionAppDomainEditZodModel>) =>
    saveFormAction(inputData, actionAppDomainEditZodModel, async (validatedData) => {
        await isAuthorizedWriteForApp(validatedData.appId);

        if (validatedData.hostname.includes('://')) {
            const url = new URL(validatedData.hostname);
            validatedData.hostname = url.hostname;
        }

        if (HostnameDnsProviderUtils.containsDnsProviderHostname(validatedData.hostname)) {
            if (!HostnameDnsProviderUtils.isValidDnsProviderHostname(validatedData.hostname)) {
                throw new ServiceException(`Invalid ${HostnameDnsProviderUtils.PROVIDER_HOSTNAME} domain. Subdomain of ${HostnameDnsProviderUtils.PROVIDER_HOSTNAME} cannot contain dots.`);
            }
        }

        await appService.saveDomain({
            ...validatedData,
            id: validatedData.id ?? undefined
        });
    });

export const deleteDomain = async (domainId: string) =>
    simpleAction(async () => {
        await isAuthorizedWriteForApp(await appService.getDomainById(domainId).then(d => d.appId));
        await appService.deleteDomainById(domainId);
        return new SuccessActionResult(undefined, 'Successfully deleted domain');
    });

export const savePort = async (prevState: any, inputData: AppPortModel, appId: string, portId?: string) =>
    saveFormAction(inputData, appPortZodModel, async (validatedData) => {
        await isAuthorizedWriteForApp(appId);
        await appService.savePort({
            ...validatedData,
            id: portId ?? undefined,
            appId
        });
    });

export const deletePort = async (portId: string) =>
    simpleAction(async () => {
        await isAuthorizedWriteForApp(await appService.getPortById(portId).then(p => p.appId));
        await appService.deletePortById(portId);
        return new SuccessActionResult(undefined, 'Successfully deleted port');
    });

export const getQuickstackDomainSuffix = async () => simpleAction(async () => {
    await getAuthUserSession();
    return agentDomainService.getGeneratedAppDomainSuffix();
});

const actionNodePortEditZodModel = nodePortEditZodModel.extend({
    appId: z.string(),
    id: z.string().nullish(),
});

export const saveNodePort = async (prevState: any, inputData: z.infer<typeof actionNodePortEditZodModel>) =>
    saveFormAction(inputData, actionNodePortEditZodModel, async (validatedData) => {
        await isAuthorizedWriteForApp(validatedData.appId);
        await appService.saveNodePort({
            ...validatedData,
            id: validatedData.id ?? undefined,
        });
    });

export const deleteNodePort = async (nodePortId: string) =>
    simpleAction(async () => {
        await isAuthorizedWriteForApp(await appService.getNodePortById(nodePortId).then(np => np.appId));
        await appService.deleteNodePortById(nodePortId);
        return new SuccessActionResult(undefined, 'Successfully deleted node port');
    });

const actionPublicEndpointEditZodModel = publicEndpointEditZodModel.extend({
    appId: z.string(),
    id: z.string().nullish(),
});

export const savePublicEndpoint = async (prevState: any, inputData: z.infer<typeof actionPublicEndpointEditZodModel>) =>
    saveFormAction(inputData, actionPublicEndpointEditZodModel, async (validatedData) => {
        await isAuthorizedWriteForApp(validatedData.appId);
        await publicEndpointService.saveAndReconcileForApp({
            id: validatedData.id ?? undefined,
            appId: validatedData.appId,
            name: validatedData.name?.trim() || null,
            publicIp: validatedData.publicIp,
            publicPort: validatedData.publicPort,
            targetPort: validatedData.targetPort,
            protocol: validatedData.protocol,
            sourceCidrsJson: JSON.stringify(parseSourceCidrsText(validatedData.sourceCidrsText)),
            proxyProtocol: validatedData.proxyProtocol,
            enabled: validatedData.enabled,
            status: validatedData.enabled ? 'PENDING' : 'DISABLED',
            lastError: null,
        });
    });

export const deletePublicEndpoint = async (publicEndpointId: string) =>
    simpleAction(async () => {
        const endpoint = await appService.getPublicEndpointById(publicEndpointId);
        await isAuthorizedWriteForApp(endpoint.appId);
        await publicEndpointService.deleteAndReconcileForApp(publicEndpointId);
        return new SuccessActionResult(undefined, 'Successfully deleted public endpoint');
    });
