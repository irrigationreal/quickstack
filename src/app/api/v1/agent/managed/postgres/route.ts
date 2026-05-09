import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import quickStackManagedService from "@/server/services/quickstack-managed-service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { UserGroupUtils } from "@/shared/utils/role.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { z } from "zod";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const createPostgresZodModel = z.object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1).max(100).optional(),
    databaseName: z.string().trim().min(1).max(100).optional(),
    username: z.string().trim().min(1).max(100).optional(),
    attachAppId: z.string().min(1).optional(),
    secretName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('DATABASE_URL'),
});

const attachPostgresZodModel = z.object({
    databaseAppId: z.string().min(1),
    appId: z.string().min(1),
    secretName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('DATABASE_URL'),
});

const listPostgresZodModel = z.object({
    projectId: z.string().min(1),
});

const destroyPostgresZodModel = z.object({
    databaseAppId: z.string().min(1),
});

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage this resource.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

async function authenticate(request: Request) {
    return await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
}

export async function GET(request: Request) {
    let authenticated;
    try {
        authenticated = await authenticate(request);
    } catch {
        return unauthorized();
    }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) {
        return forbidden('API key does not have app read permission.');
    }

    const requestUrl = new URL(request.url);
    const parsed = listPostgresZodModel.safeParse({ projectId: requestUrl.searchParams.get('projectId') });
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'projectId is required.' }, { status: 400 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, { id: '', projectId: parsed.data.projectId })) {
        return forbidden();
    }

    const databases = await quickStackManagedService.listPostgres(parsed.data.projectId);
    return NextResponse.json({ status: 'success', projectId: parsed.data.projectId, databases });
}

export async function POST(request: Request) {
    let authenticated;
    try {
        authenticated = await authenticate(request);
    } catch {
        return unauthorized();
    }

    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) {
        return forbidden('API key does not have app configuration permission.');
    }

    const raw = await request.json().catch(() => null);
    const mode = raw?.mode === 'attach' ? 'attach' : 'create';

    try {
        if (mode === 'attach') {
            const input = attachPostgresZodModel.parse(raw);
            const [databaseApp, app] = await Promise.all([
                appService.getById(input.databaseAppId),
                appService.getById(input.appId),
            ]);
            if (!apiKeyService.isAllowedForApp(authenticated.apiKey, databaseApp) || !apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
                return forbidden();
            }
            try {
                assertSessionCanWriteApp(authenticated.session, app.id);
            } catch {
                return forbidden();
            }
            const attached = await quickStackManagedService.attachPostgres({
                databaseAppId: input.databaseAppId,
                appId: input.appId,
                secretName: input.secretName,
                actor: authenticated.auditActor,
            });
            return NextResponse.json({ status: 'success', ...attached });
        }

        const input = createPostgresZodModel.parse(raw);
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, { id: '', projectId: input.projectId })) {
            return forbidden();
        }
        if (!UserGroupUtils.sessionCanCreateNewAppsForProject(authenticated.session, input.projectId)) {
            return forbidden('API key user cannot create apps in this project.');
        }
        if (input.attachAppId) {
            const app = await appService.getById(input.attachAppId);
            if (app.projectId !== input.projectId || !apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
                return forbidden();
            }
            try {
                assertSessionCanWriteApp(authenticated.session, app.id);
            } catch {
                return forbidden();
            }
        }

        const created = await quickStackManagedService.createPostgres({
            projectId: input.projectId,
            name: input.name,
            databaseName: input.databaseName,
            username: input.username,
            actor: authenticated.auditActor,
        });
        await appService.buildAndDeploy(created.databaseApp.id, false, authenticated.auditActor);
        const attached = input.attachAppId ? await quickStackManagedService.attachPostgres({
            databaseAppId: created.databaseApp.id,
            appId: input.attachAppId,
            secretName: input.secretName,
            actor: authenticated.auditActor,
        }) : null;

        return NextResponse.json({
            status: 'success',
            databaseAppId: created.databaseApp.id,
            projectId: created.databaseApp.projectId,
            name: created.databaseApp.name,
            database: {
                databaseName: created.databaseInfo.databaseName,
                hostname: created.databaseInfo.hostname,
                port: created.databaseInfo.port,
            },
            attached,
        });
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'MANAGED_POSTGRES_REQUESTED',
            outcome: 'FAILED',
            targetType: 'PROJECT',
            message: error instanceof Error ? error.message : 'Managed Postgres request failed.',
        });
        if (error instanceof z.ZodError || error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error instanceof ServiceException ? error.message : 'Invalid managed Postgres payload.' }, { status: 400 });
        }
        throw error;
    }
}

export async function DELETE(request: Request) {
    let authenticated;
    try {
        authenticated = await authenticate(request);
    } catch {
        return unauthorized();
    }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) {
        return forbidden('API key does not have app configuration permission.');
    }

    const parsed = destroyPostgresZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid managed Postgres destroy payload.' }, { status: 400 });
    }

    try {
        const databaseApp = await appService.getById(parsed.data.databaseAppId);
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, databaseApp)) {
            return forbidden();
        }
        try {
            assertSessionCanWriteApp(authenticated.session, databaseApp.id);
        } catch {
            return forbidden();
        }
        const destroyed = await quickStackManagedService.destroyPostgres({
            databaseAppId: parsed.data.databaseAppId,
            actor: authenticated.auditActor,
        });
        return NextResponse.json({ status: 'success', destroyed });
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'MANAGED_POSTGRES_DESTROY_REQUESTED',
            outcome: 'FAILED',
            targetType: 'APP',
            targetId: parsed.data.databaseAppId,
            message: error instanceof Error ? error.message : 'Managed Postgres destroy failed.',
        });
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
        }
        throw error;
    }
}
