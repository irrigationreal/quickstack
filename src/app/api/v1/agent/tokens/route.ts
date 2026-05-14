import apiKeyService from "@/server/services/api-key.service";
import { TokenScopeZodModel } from "@/shared/model/agent-token.model";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createTokenZodModel = z.object({ scope: TokenScopeZodModel.default('actor') });
const revokeTokenZodModel = z.object({ tokenId: z.string().min(1) });

function unauthorized(message = 'Missing or invalid API key.') {
    return NextResponse.json({ status: 'error', message }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage tokens.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function GET(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) return forbidden('API key does not have app read permission.');
    return NextResponse.json({ status: 'success', tokens: await apiKeyService.listTokens(authenticated.auditActor, authenticated.apiKey) });
}

export async function POST(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) return forbidden('API key does not have app write permission.');
    const parsed = createTokenZodModel.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ status: 'error', message: 'Invalid token payload.' }, { status: 400 });
    if (!await apiKeyService.canIssueScope(authenticated.apiKey, parsed.data.scope)) {
        return NextResponse.json({
            status: 'error',
            message: 'Requested token scope is wider than the current token is allowed to issue.',
            scope: { current: apiKeyService.scopeForToken(authenticated.apiKey), requested: parsed.data.scope },
            remediation: 'Use an actor-scoped token or request a scope within the current token boundary.',
        }, { status: 403 });
    }
    const issued = await apiKeyService.issueToken(authenticated.auditActor, parsed.data.scope);
    return NextResponse.json({ status: 'success', ...issued, notice: 'Save this token; it will not be shown again.' });
}

export async function DELETE(request: Request) {
    let authenticated;
    try { authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization')); } catch (error) { return unauthorized(error instanceof Error ? error.message : undefined); }
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:write')) return forbidden('API key does not have app write permission.');
    const parsed = revokeTokenZodModel.safeParse(await request.json().catch(() => Object.fromEntries(new URL(request.url).searchParams.entries())));
    if (!parsed.success) return NextResponse.json({ status: 'error', message: 'Invalid token revoke payload.' }, { status: 400 });
    try {
        const revoked = await apiKeyService.revokeToken(authenticated.auditActor, parsed.data.tokenId, authenticated.apiKey);
        return NextResponse.json({ status: 'success', revoked, message: `Token revoked at ${revoked.revokedAt}.` });
    } catch (error) {
        return NextResponse.json({ status: 'error', message: error instanceof Error ? error.message : 'Token could not be revoked.' }, { status: 403 });
    }
}
