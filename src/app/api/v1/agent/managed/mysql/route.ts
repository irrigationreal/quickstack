import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import quickStackManagedService from "@/server/services/quickstack-managed-service";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { UserGroupUtils } from "@/shared/utils/role.utils";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createMysqlZodModel = z.object({ projectId: z.string().min(1), name: z.string().optional(), databaseName: z.string().optional(), username: z.string().optional(), attachAppId: z.string().optional(), secretName: z.string().default('MYSQL_URL') });
const attachMysqlZodModel = z.object({ mysqlAppId: z.string().min(1), appId: z.string().min(1), secretName: z.string().default('MYSQL_URL') });
const destroyMysqlZodModel = z.object({ mysqlAppId: z.string().min(1) });

function unauthorized(message = 'Missing or invalid API key.') { return NextResponse.json({ status: 'error', message }, { status: 401 }); }
function forbidden(message = 'API key is not authorized to manage this resource.') { return NextResponse.json({ status: 'error', message }, { status: 403 }); }

export async function GET(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) return forbidden('API key does not have app read permission.');
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) {
        const managedApp = await appService.getById(id).catch(() => null);
        if (!managedApp) return NextResponse.json({ status: 'error', message: 'Managed MySQL app not found.' }, { status: 404 });
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, managedApp)) return forbidden();
        try {
            return NextResponse.json({ status: 'success', service: await quickStackManagedService.getManagedStatus('mysql', id) });
        } catch (error) {
            if (error instanceof ServiceException) return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
            throw error;
        }
    }
    const projectId = url.searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ status: 'error', message: 'projectId is required.' }, { status: 400 });
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, { id: '', projectId })) return forbidden();
    const services = await quickStackManagedService.listMysql(projectId);
    const mysql = services.map(service => ({
        id: service.id,
        name: service.name,
        projectId: service.projectId,
        databaseName: service.connection.databaseName,
        hostname: service.connection.hostname,
        port: service.connection.port,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
    }));
    return NextResponse.json({ status: 'success', projectId, services, mysql });
}

export async function POST(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) return forbidden('API key does not have app configuration permission.');
    const raw = await request.json().catch(() => null);
    try {
        if (raw?.mode === 'attach') {
            const input = attachMysqlZodModel.parse(raw);
            const [mysqlApp, app] = await Promise.all([appService.getById(input.mysqlAppId), appService.getById(input.appId)]);
            if (!apiKeyService.isAllowedForApp(authenticated.apiKey, mysqlApp) || !apiKeyService.isAllowedForApp(authenticated.apiKey, app)) return forbidden();
            try { assertSessionCanWriteApp(authenticated.session, app.id); } catch { return forbidden(); }
            return NextResponse.json({ status: 'success', ...(await quickStackManagedService.attachMysql({ mysqlAppId: input.mysqlAppId, appId: input.appId, secretName: input.secretName, actor: authenticated.auditActor })) });
        }
        const input = createMysqlZodModel.parse(raw);
        if (!apiKeyService.isAllowedForApp(authenticated.apiKey, { id: '', projectId: input.projectId })) return forbidden();
        if (!UserGroupUtils.sessionCanCreateNewAppsForProject(authenticated.session, input.projectId)) return forbidden('API key user cannot create apps in this project.');
        const attachTarget = input.attachAppId ? await appService.getById(input.attachAppId) : null;
        if (attachTarget) {
            if (!apiKeyService.isAllowedForApp(authenticated.apiKey, attachTarget)) return forbidden();
            try { assertSessionCanWriteApp(authenticated.session, attachTarget.id); } catch { return forbidden(); }
        }
        const created = await quickStackManagedService.createMysql({ projectId: input.projectId, name: input.name, databaseName: input.databaseName, username: input.username, actor: authenticated.auditActor });
        await appService.buildAndDeploy(created.mysqlApp.id, false, authenticated.auditActor);
        const attached = attachTarget ? await quickStackManagedService.attachMysql({ mysqlAppId: created.mysqlApp.id, appId: attachTarget.id, secretName: input.secretName, actor: authenticated.auditActor }) : null;
        return NextResponse.json({ status: 'success', mysqlAppId: created.mysqlApp.id, projectId: created.mysqlApp.projectId, service: quickStackManagedService.normalizeManagedService(created.mysqlApp, 'mysql', created.databaseInfo), attached });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error instanceof ServiceException ? error.message : 'Invalid managed MySQL payload.' }, { status: 400 });
        }
        throw error;
    }
}

export async function DELETE(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) return forbidden('API key does not have app configuration permission.');
    const parsed = destroyMysqlZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ status: 'error', message: 'Invalid managed MySQL destroy payload.' }, { status: 400 });
    const mysqlApp = await appService.getById(parsed.data.mysqlAppId);
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, mysqlApp)) return forbidden();
    try { assertSessionCanWriteApp(authenticated.session, mysqlApp.id); } catch { return forbidden(); }
    return NextResponse.json({ status: 'success', destroyed: await quickStackManagedService.destroyMysql({ mysqlAppId: parsed.data.mysqlAppId, actor: authenticated.auditActor }) });
}
