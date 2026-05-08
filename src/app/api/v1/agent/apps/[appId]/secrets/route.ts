import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import appSecretEnvService from "@/server/services/app-secret-env.service";
import auditService from "@/server/services/audit.service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { quickDeploySecretEnvSetZodModel } from "@/shared/model/quickdeploy.model";
import { ServiceException } from "@/shared/model/service.exception.model";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage secrets for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

async function authenticateAndAuthorize(request: Request, appId: string) {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getById(appId);

    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_SECRET_ENV_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: 'API key does not have apps:write scope.',
        });
        return { response: forbidden('API key does not have app configuration permission.') };
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_SECRET_ENV_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: 'API key allowlist does not include this app.',
        });
        return { response: forbidden() };
    }

    try {
        assertSessionCanWriteApp(authenticated.session, app.id);
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_SECRET_ENV_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: error instanceof Error ? error.message : 'API key user is not authorized for this app.',
        });
        return { response: forbidden() };
    }

    return { authenticated, app };
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authorized;
    const { appId } = await params;
    try {
        authorized = await authenticateAndAuthorize(request, appId);
    } catch {
        return unauthorized();
    }
    if ('response' in authorized) return authorized.response;

    const secrets = await appSecretEnvService.listNames(authorized.app.id);
    return NextResponse.json({
        status: 'success',
        appId: authorized.app.id,
        projectId: authorized.app.projectId,
        secrets,
    });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authorized;
    const { appId } = await params;
    try {
        authorized = await authenticateAndAuthorize(request, appId);
    } catch {
        return unauthorized();
    }
    if ('response' in authorized) return authorized.response;

    const parsed = quickDeploySecretEnvSetZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid secret env payload.' }, { status: 400 });
    }

    const secrets = Object.entries(parsed.data.secrets).map(([name, value]) => ({ name, value }));

    try {
        if (secrets.length > 0) {
            await appSecretEnvService.upsertMany({
                app: authorized.app,
                secrets,
                actor: authorized.authenticated.auditActor,
            });
        }
        if (parsed.data.unset.length > 0) {
            await appSecretEnvService.deleteMany({
                app: authorized.app,
                names: parsed.data.unset,
                actor: authorized.authenticated.auditActor,
            });
        }
        const list = await appSecretEnvService.listNames(authorized.app.id);
        return NextResponse.json({
            status: 'success',
            appId: authorized.app.id,
            projectId: authorized.app.projectId,
            secrets: list,
        });
    } catch (error) {
        await auditService.recordBestEffort({
            ...authorized.authenticated.auditActor,
            action: 'AGENT_APP_SECRET_ENV_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: authorized.app.id,
            projectId: authorized.app.projectId,
            appId: authorized.app.id,
            appName: authorized.app.name,
            message: error instanceof Error ? error.message : 'Secret env mutation failed.',
            metadata: {
                setNames: secrets.map(secret => secret.name),
                unsetNames: parsed.data.unset,
            },
        });
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
        }
        throw error;
    }
}
