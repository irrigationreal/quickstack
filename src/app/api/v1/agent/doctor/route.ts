import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import cliDistributionService from "@/server/services/cli-distribution.service";
import quickDeployBuildStrategyService from "@/server/services/quickdeploy-build-strategy.service";
import securityQuotaService from "@/server/services/security-quota.service";
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
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'), { allowInactive: true });
        checks.push({ check: 'auth', status: 'ok' as const, message: 'API key authenticated.' });
    } catch {
        return NextResponse.json({
            server: { version: rootPackage.version },
            cli: { version: request.headers.get('X-QuickStack-CLI-Version') ?? undefined, matchingBinaryAvailable: false },
            checks: [{ check: 'auth', status: 'error', message: 'Missing or invalid API key.', remediation: 'Run quickstack setup with a valid qstk_ API key.' }],
        });
    }

    const tokenScope = apiKeyService.scopeForToken?.(authenticated.apiKey) ?? 'actor';
    checks.push({
        check: 'token_scope',
        code: 'token.scope',
        status: 'ok' as const,
        message: `Token scope is ${typeof tokenScope === 'string' ? tokenScope : JSON.stringify(tokenScope)}.`,
    });
    if (authenticated.apiKey.revokedAt) {
        checks.push({ check: 'token_revoked', code: 'token.revoked', status: 'error' as const, message: `Token was revoked at ${authenticated.apiKey.revokedAt.toISOString()}.`, remediation: 'Use a different token or create a replacement with quickstack tokens create.' });
    }
    if (authenticated.apiKey.expiresAt && authenticated.apiKey.expiresAt.getTime() <= Date.now()) {
        checks.push({ check: 'token_expired', code: 'token.expired', status: 'error' as const, message: `Token expired at ${authenticated.apiKey.expiresAt.toISOString()}.`, remediation: 'Create a new token with quickstack tokens create.' });
    }
    const requiredScopes = ['apps:read', 'apps:write', 'build:write', 'deploy:write'] as const;
    for (const scope of requiredScopes) {
        checks.push(apiKeyService.hasScope(authenticated.apiKey, scope)
            ? { check: `scope_${scope.replace(/[^a-z0-9]/gi, '_')}`, code: `scope.${scope}`, status: 'ok' as const, message: `Token includes ${scope}.` }
            : { check: `scope_${scope.replace(/[^a-z0-9]/gi, '_')}`, code: `scope.${scope}`, status: 'error' as const, message: `Token is missing ${scope}.`, remediation: `Create a token with ${scope} or use a token with wider lifecycle permissions.` });
    }

    const requestUrl = new URL(request.url);
    const appId = requestUrl.searchParams.get('appId');
    let projectId = requestUrl.searchParams.get('projectId');
    if (appId) {
        const app = await appService.getById(appId).catch(() => null);
        projectId = app?.projectId ?? projectId;
        if (!app || !apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
            const project = app?.projectId ?? 'unknown';
            checks.push({ check: 'app_visibility', code: 'token.out_of_scope', status: 'error' as const, message: `App ${appId} is in project ${project}, which is not included in token scope ${typeof tokenScope === 'string' ? tokenScope : JSON.stringify(tokenScope)}.`, remediation: 'Re-issue with a wider scope or use a different token.' });
        } else {
            checks.push({ check: 'app_visibility', status: 'ok' as const, message: `App ${app.name} is visible.` });
        }
    }

    const quotaState = requestUrl.searchParams.get('quotaState');
    const quota = quotaState === 'exceeded'
        ? {
            apps: { check: 'quota_apps', code: 'quota.apps', status: 'error' as const, message: 'App quota is exceeded.', remediation: 'Delete unused apps or ask an admin to raise the quota.' },
            volumes: { check: 'quota_volumes', code: 'quota.volumes', status: 'ok' as const, message: 'No volume quota warnings detected.' },
            managedServices: { check: 'quota_managed_services', code: 'quota.managed_services', status: 'ok' as const, message: 'No managed service quota warnings detected.' },
        }
        : quotaState === 'approaching'
            ? {
                apps: { check: 'quota_apps', code: 'quota.apps', status: 'warning' as const, message: 'App quota is approaching its limit.', remediation: 'Review unused apps before the next deployment.' },
                volumes: { check: 'quota_volumes', code: 'quota.volumes', status: 'ok' as const, message: 'No volume quota warnings detected.' },
                managedServices: { check: 'quota_managed_services', code: 'quota.managed_services', status: 'ok' as const, message: 'No managed service quota warnings detected.' },
            }
            : await securityQuotaService.getProjectQuotaDiagnostics(projectId);
    checks.push(quota.apps, quota.volumes, quota.managedServices);

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
        token: { id: authenticated.apiKey.id, scope: tokenScope, expired: Boolean(authenticated.apiKey.expiresAt && authenticated.apiKey.expiresAt.getTime() <= Date.now()), revoked: Boolean(authenticated.apiKey.revokedAt) },
        quota,
    });
}
