import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import { assertSessionCanReadApp, assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const envNameZod = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const envUpdateZodModel = z.object({
    env: z.record(envNameZod, z.string()).optional().default({}),
    unset: z.array(envNameZod).optional().default([]),
});

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage env for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

function parseEnv(envVars: string | null | undefined) {
    if (!envVars) return [];
    return envVars.split('\n').filter(Boolean).map(line => {
        const [name, ...valueParts] = line.split('=');
        return { name, value: valueParts.join('=') };
    }).filter(entry => envNameZod.safeParse(entry.name).success);
}

function serializeEnv(env: { name: string; value: string }[]) {
    return env.map(entry => `${entry.name}=${entry.value}`).join('\n');
}

async function authenticateAndAuthorize(request: Request, appId: string, scope: 'apps:read' | 'apps:write') {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getById(appId);

    if (!apiKeyService.hasScope(authenticated.apiKey, scope)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_ENV_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: `API key does not have ${scope} scope.`,
        });
        return { response: forbidden(scope === 'apps:read' ? 'API key does not have app read permission.' : 'API key does not have app configuration permission.') };
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return { response: forbidden() };
    }

    try {
        if (scope === 'apps:write') {
            assertSessionCanWriteApp(authenticated.session, app.id);
        } else {
            assertSessionCanReadApp(authenticated.session, app.id);
        }
    } catch {
        return { response: forbidden(scope === 'apps:read' ? 'API key user is not authorized to read this app.' : undefined) };
    }

    return { authenticated, app };
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:read');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const env = parseEnv(authorized.app.envVars);
    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, env });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if (authorized.response) return authorized.response;

    const parsed = envUpdateZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid env payload.' }, { status: 400 });
    }

    const byName = new Map(parseEnv(authorized.app.envVars).map(entry => [entry.name, entry.value]));
    for (const name of parsed.data.unset) byName.delete(name);
    for (const [name, value] of Object.entries(parsed.data.env)) byName.set(name, value);
    const env = Array.from(byName.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => ({ name, value }));

    await appService.save({ id: authorized.app.id, envVars: serializeEnv(env) }, false);
    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_APP_ENV_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP',
        targetId: authorized.app.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        metadata: { setNames: Object.keys(parsed.data.env), unsetNames: parsed.data.unset },
    });

    return NextResponse.json({ status: 'success', appId: authorized.app.id, projectId: authorized.app.projectId, env });
}
