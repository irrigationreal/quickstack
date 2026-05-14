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

    const projectId = new URL(request.url).searchParams.get('projectId');
    const projects = await projectService.getAllProjects();
    const visibleProjects = apiKeyService.filterAllowedProjects(
        authenticated.apiKey,
        projects.filter(project => UserGroupUtils.sessionHasReadAccessToProject(authenticated.session, project.id)),
    );

    const apps = visibleProjects
        .filter(project => !projectId || project.id === projectId)
        .flatMap(project => project.apps
            .filter(app => UserGroupUtils.sessionHasReadAccessForApp(authenticated.session, app.id))
            .map(app => ({
                id: app.id,
                projectId: app.projectId,
                name: app.name,
                status: app.replicas === 0 ? 'stopped' : 'running',
                lastDeployedAt: app.updatedAt instanceof Date ? app.updatedAt.toISOString() : undefined,
            })));

    return NextResponse.json({ apps });
}
