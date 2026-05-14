import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import cliDistributionService from "@/server/services/cli-distribution.service";
import quickDeployBuildStrategyService from "@/server/services/quickdeploy-build-strategy.service";
import rootPackage from "../../../../../../package.json";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function major(version?: string | null) {
    return version?.match(/^(\d+)\./)?.[1];
}

export async function GET(request: Request) {
    const checks = [];
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
        checks.push({ check: 'auth', status: 'ok' as const, message: 'API key authenticated.' });
    } catch {
        return NextResponse.json({
            server: { version: rootPackage.version },
            cli: { version: request.headers.get('X-QuickStack-CLI-Version') ?? undefined, matchingBinaryAvailable: false },
            checks: [{ check: 'auth', status: 'error', message: 'Missing or invalid API key.', remediation: 'Run quickstack setup with a valid qstk_ API key.' }],
        });
    }

    const requestUrl = new URL(request.url);
    const appId = requestUrl.searchParams.get('appId');
    if (appId) {
        const app = await appService.getById(appId).catch(() => null);
        if (!app || !apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
            checks.push({ check: 'app_visibility', status: 'error' as const, message: 'App is missing or not visible to this API key.', remediation: 'Use an API key allowlisted for this app or project.' });
        } else {
            checks.push({ check: 'app_visibility', status: 'ok' as const, message: `App ${app.name} is visible.` });
        }
    }

    const capabilities = quickDeployBuildStrategyService.getCapabilities();
    checks.push({ check: 'build_capabilities', status: 'ok' as const, message: `Available build strategies: ${capabilities.strategies.join(', ')}.` });
    if (!capabilities.remoteBuilder) {
        checks.push({ check: 'remote_builder', status: 'warning' as const, message: 'Remote builder is not configured.', remediation: 'Use source-tar, local-docker, or existing-image.' });
    }

    const cliVersion = request.headers.get('X-QuickStack-CLI-Version') ?? undefined;
    const matchingBinaryAvailable = cliDistributionService.listAvailableBinaries().some(binary => binary.version === rootPackage.version);
    if (cliVersion && major(cliVersion) !== major(rootPackage.version)) {
        checks.push({ check: 'version_skew', status: 'warning' as const, message: `CLI ${cliVersion} and server ${rootPackage.version} have different major versions.`, remediation: 'Re-run quickstack setup --server <url> to install the server-matched CLI.' });
    } else {
        checks.push({ check: 'version_skew', status: 'ok' as const, message: 'CLI/server major versions are compatible.' });
    }

    return NextResponse.json({
        actor: {
            id: authenticated.session.id,
            kind: 'agent',
            displayName: authenticated.apiKey.name || authenticated.session.email,
            email: authenticated.session.email,
        },
        server: { version: rootPackage.version },
        cli: { version: cliVersion, matchingBinaryAvailable },
        checks,
    });
}
