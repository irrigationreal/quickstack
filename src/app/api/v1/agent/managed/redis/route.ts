import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import quickStackManagedService from "@/server/services/quickstack-managed-service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { UserGroupUtils } from "@/shared/utils/role.utils";
import { z } from "zod";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const envSecretNameZod = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const createRedisZodModel = z.object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1).max(100).optional(),
    attachAppId: z.string().min(1).optional(),
    secretName: envSecretNameZod.default('REDIS_URL'),
});

const attachRedisZodModel = z.object({
    redisAppId: z.string().min(1),
    appId: z.string().min(1),
    secretName: envSecretNameZod.default('REDIS_URL'),
});

const listRedisZodModel = z.object({
    projectId: z.string().min(1),
});

const destroyRedisZodModel = z.object({
    redisAppId: z.string().min(1),
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
    const id = requestUrl.searchParams.get('id');
    if (id) {
        const managedApp = await appService.getById(id).catch(() => null);
        if (!managedApp) {
            return NextResponse.json({ status: 'error', message: 'Managed Redis app not found.' }, { status: 404 });
        }
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, managedApp)) {
            return forbidden();
        }
        try {
            return NextResponse.json({ status: 'success', service: await quickStackManagedService.getManagedStatus('redis', id) });
        } catch (error) {
            if (error instanceof ServiceException) {
                return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
            }
            throw error;
        }
    }
    const parsed = listRedisZodModel.safeParse({ projectId: requestUrl.searchParams.get('projectId') });
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'projectId is required.' }, { status: 400 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, { id: '', projectId: parsed.data.projectId })) {
        return forbidden();
    }

    const services = await quickStackManagedService.listRedis(parsed.data.projectId);
    const redis = services.map(service => ({
        id: service.id,
        name: service.name,
        projectId: service.projectId,
        hostname: service.connection.hostname,
        port: service.connection.port,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
    }));
    return NextResponse.json({ status: 'success', projectId: parsed.data.projectId, services, redis });
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
            const input = attachRedisZodModel.parse(raw);
            const [redisApp, app] = await Promise.all([
                appService.getById(input.redisAppId),
                appService.getById(input.appId),
            ]);
            if (!apiKeyService.isAllowedForApp(authenticated.apiKey, redisApp) || !apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
                return forbidden();
            }
            try {
                assertSessionCanWriteApp(authenticated.session, app.id);
            } catch {
                return forbidden();
            }
            const attached = await quickStackManagedService.attachRedis({
                redisAppId: input.redisAppId,
                appId: input.appId,
                secretName: input.secretName,
                actor: authenticated.auditActor,
            });
            return NextResponse.json({ status: 'success', ...attached });
        }

        const input = createRedisZodModel.parse(raw);
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

        const created = await quickStackManagedService.createRedis({
            projectId: input.projectId,
            name: input.name,
            actor: authenticated.auditActor,
        });
        await appService.buildAndDeploy(created.redisApp.id, false, authenticated.auditActor);
        const attached = input.attachAppId ? await quickStackManagedService.attachRedis({
            redisAppId: created.redisApp.id,
            appId: input.attachAppId,
            secretName: input.secretName,
            actor: authenticated.auditActor,
        }) : null;

        return NextResponse.json({
            status: 'success',
            service: quickStackManagedService.normalizeManagedService(created.redisApp, 'redis', created.databaseInfo),
            redisAppId: created.redisApp.id,
            projectId: created.redisApp.projectId,
            name: created.redisApp.name,
            redis: {
                hostname: created.databaseInfo.hostname,
                port: created.databaseInfo.port,
            },
            attached,
        });
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'MANAGED_REDIS_REQUESTED',
            outcome: 'FAILED',
            targetType: 'PROJECT',
            message: error instanceof Error ? error.message : 'Managed Redis request failed.',
        });
        if (error instanceof z.ZodError || error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error instanceof ServiceException ? error.message : 'Invalid managed Redis payload.' }, { status: 400 });
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

    const parsed = destroyRedisZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid managed Redis destroy payload.' }, { status: 400 });
    }

    try {
        const redisApp = await appService.getById(parsed.data.redisAppId);
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, redisApp)) {
            return forbidden();
        }
        try {
            assertSessionCanWriteApp(authenticated.session, redisApp.id);
        } catch {
            return forbidden();
        }
        const destroyed = await quickStackManagedService.destroyRedis({
            redisAppId: parsed.data.redisAppId,
            actor: authenticated.auditActor,
        });
        return NextResponse.json({ status: 'success', destroyed });
    } catch (error) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'MANAGED_REDIS_DESTROY_REQUESTED',
            outcome: 'FAILED',
            targetType: 'APP',
            targetId: parsed.data.redisAppId,
            message: error instanceof Error ? error.message : 'Managed Redis destroy failed.',
        });
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
        }
        throw error;
    }
}
