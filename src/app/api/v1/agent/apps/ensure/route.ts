import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import agentDomainService from "@/server/services/agent-domain.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { quickDeployEnsureAppZodModel } from "@/shared/model/quickdeploy.model";
import { Constants } from "@/shared/utils/constants";
import { UserGroupUtils } from "@/shared/utils/role.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to configure this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function POST(request: Request) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_ENSURE_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            message: 'API key does not have apps:write scope.',
        });
        return forbidden('API key does not have app configuration permission.');
    }

    const parsed = quickDeployEnsureAppZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid QuickDeploy app configuration.' }, { status: 400 });
    }
    const input = parsed.data;

    const existingApp = input.appId ? await appService.getById(input.appId).catch(() => null) : null;
    if (existingApp && existingApp.projectId !== input.projectId) {
        return NextResponse.json({ status: 'error', message: 'App does not belong to the requested project.' }, { status: 400 });
    }

    if (existingApp) {
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, existingApp)) {
            return forbidden();
        }
        try {
            assertSessionCanWriteApp(authenticated.session, existingApp.id);
        } catch {
            return forbidden();
        }
    } else {
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, { id: input.appId ?? '', projectId: input.projectId })) {
            return forbidden();
        }
        if (!UserGroupUtils.sessionCanCreateNewAppsForProject(authenticated.session, input.projectId)) {
            return forbidden('API key user cannot create apps in this project.');
        }
    }

    const isManagedSource = input.mode !== 'image';
    const buildMethod = input.mode === 'image' ? existingApp?.buildMethod ?? 'RAILPACK' : 'DOCKERFILE';
    const dockerfilePath = input.mode === 'static'
        ? './.quickstack/generated-static.Dockerfile'
        : input.mode === 'dockerfile'
            ? './Dockerfile'
            : existingApp?.dockerfilePath ?? './Dockerfile';
    const savedApp = await appService.save({
        ...(existingApp ? { id: existingApp.id } : {}),
        name: input.name,
        projectId: input.projectId,
        appType: 'APP',
        sourceType: isManagedSource ? 'QUICKDEPLOY_UPLOAD' : 'CONTAINER',
        buildMethod,
        dockerfilePath,
        containerImageSource: input.image,
        containerRegistryUsername: isManagedSource ? null : input.registryUsername ?? existingApp?.containerRegistryUsername ?? null,
        containerRegistryPassword: isManagedSource ? null : input.registryPassword ?? existingApp?.containerRegistryPassword ?? null,
        replicas: existingApp?.replicas ?? 1,
        ingressNetworkPolicy: existingApp?.ingressNetworkPolicy ?? Constants.DEFAULT_INGRESS_NETWORK_POLICY_APPS,
        egressNetworkPolicy: existingApp?.egressNetworkPolicy ?? Constants.DEFAULT_EGRESS_NETWORK_POLICY_APPS,
        useNetworkPolicy: existingApp?.useNetworkPolicy ?? true,
    }, !existingApp);

    const extendedApp = await appService.getExtendedById(savedApp.id);
    const existingPort = extendedApp.appPorts.find(port => port.port === input.port);
    if (!existingPort) {
        await appService.savePort({
            appId: savedApp.id,
            port: input.port,
        });
    }

    const existingDomain = input.customHostname
        ? extendedApp.appDomains.find(domain => domain.hostname === input.customHostname)
        : extendedApp.appDomains[0];
    const hostname = input.customHostname ?? existingDomain?.hostname ?? await agentDomainService.generateHostname(input.domainPrefix ?? input.name);
    await appService.saveDomain({
        id: existingDomain?.id,
        appId: savedApp.id,
        hostname,
        port: input.port,
        useSsl: true,
        redirectHttps: !input.customHostname,
    });

    await auditService.recordBestEffort({
        ...authenticated.auditActor,
        action: 'AGENT_APP_ENSURE_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: savedApp.id,
        projectId: savedApp.projectId,
        appId: savedApp.id,
        appName: savedApp.name,
        metadata: {
            mode: input.mode,
            port: input.port,
            domainPrefix: input.domainPrefix,
            customHostname: input.customHostname,
            hasRegistryCredentials: Boolean(input.registryUsername || input.registryPassword),
        },
    });

    return NextResponse.json({
        status: 'success',
        appId: savedApp.id,
        projectId: savedApp.projectId,
        name: savedApp.name,
        image: input.image,
        port: input.port,
        hostname,
        url: `https://${hostname}`,
    });
}
