import apiKeyService from "@/server/services/api-key.service";
import quickDeployPlanService from "@/server/services/quickdeploy-plan.service";
import { AgentLaunchPlanRequestZodModel } from "@/shared/model/agent-launch-plan.model";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

export async function POST(request: Request) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) {
        return NextResponse.json({ status: 'error', message: 'API key does not have app read permission.' }, { status: 403 });
    }

    const parsed = AgentLaunchPlanRequestZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid launch plan evidence.' }, { status: 400 });
    }

    return NextResponse.json(quickDeployPlanService.plan(parsed.data));
}
