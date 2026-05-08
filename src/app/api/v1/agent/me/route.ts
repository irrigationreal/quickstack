import apiKeyService from "@/server/services/api-key.service";
import projectService from "@/server/services/project.service";
import { UserGroupUtils } from "@/shared/utils/role.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

export async function GET(request: Request) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) {
        return NextResponse.json({ status: 'error', message: 'API key does not have app read permission.' }, { status: 403 });
    }

    const projects = await projectService.getAllProjects();
    const visibleProjects = projects
        .filter(project => UserGroupUtils.sessionHasReadAccessToProject(authenticated.session, project.id))
        .map(project => ({
            id: project.id,
            name: project.name,
            apps: project.apps
                .filter(app => UserGroupUtils.sessionHasReadAccessForApp(authenticated.session, app.id))
                .filter(app => apiKeyService.isAllowedForApp(authenticated.apiKey, app))
                .map(app => ({
                    id: app.id,
                    name: app.name,
                    projectId: app.projectId,
                    appType: app.appType,
                    sourceType: app.sourceType,
                })),
        }))
        .filter(project => project.apps.length > 0);

    return NextResponse.json({
        status: 'success',
        user: {
            email: authenticated.session.email,
        },
        projects: visibleProjects,
    });
}
