const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), scopeForToken: vi.fn(), canIssueScope: vi.fn(), listTokens: vi.fn(), issueToken: vi.fn(), revokeToken: vi.fn() }));
vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));

import { DELETE, GET, POST } from './route';

function request(method = 'GET', body?: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/tokens', { method, headers: { authorization: 'Bearer qstk_prefix_secret' }, body: body ? JSON.stringify(body) : undefined });
}

describe('agent tokens route', () => {
    const auditActor = { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'agent@example.com' };
    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ apiKey: { id: 'key-1' }, auditActor });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.scopeForToken.mockReturnValue('actor');
        apiKeyMocks.canIssueScope.mockResolvedValue(true);
        apiKeyMocks.listTokens.mockResolvedValue([{ id: 'token-1', prefix: 'qstk_abc…', scope: 'actor', issuedAt: '2026-05-14T00:00:00Z', issuedByActorId: 'user-1' }]);
        apiKeyMocks.issueToken.mockResolvedValue({ token: { id: 'token-2', prefix: 'qstk_def…', scope: { project: 'proj-1' }, issuedAt: '2026-05-14T00:00:00Z', issuedByActorId: 'user-1' }, plaintextToken: 'qstk_def_secret' });
        apiKeyMocks.revokeToken.mockResolvedValue({ id: 'token-1', prefix: 'qstk_abc…', scope: 'actor', issuedAt: '2026-05-14T00:00:00Z', issuedByActorId: 'user-1', revokedAt: '2026-05-14T00:01:00Z' });
    });

    it('lists tokens without full secrets', async () => {
        const response = await GET(request());
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(apiKeyMocks.listTokens).toHaveBeenCalledWith(auditActor, { id: 'key-1' });
        expect(body.tokens[0].prefix).toBe('qstk_abc…');
        expect(JSON.stringify(body)).not.toContain('secret');
    });

    it('creates a scoped token and returns the plaintext once', async () => {
        const response = await POST(request('POST', { scope: { project: 'proj-1' } }));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(apiKeyMocks.issueToken).toHaveBeenCalledWith(auditActor, { project: 'proj-1' });
        expect(body.plaintextToken).toBe('qstk_def_secret');
        expect(body.notice).toContain('will not be shown again');
    });

    it('revokes a token', async () => {
        const response = await DELETE(request('DELETE', { tokenId: 'token-1' }));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(apiKeyMocks.revokeToken).toHaveBeenCalledWith(auditActor, 'token-1', { id: 'key-1' });
        expect(body.message).toContain('revoked');
    });

    it('rejects keys without write scope for create', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);
        const response = await POST(request('POST', { scope: 'actor' }));
        expect(response.status).toBe(403);
    });

    it('rejects attempts to mint a token wider than the current token scope', async () => {
        apiKeyMocks.canIssueScope.mockResolvedValue(false);
        apiKeyMocks.scopeForToken.mockReturnValue({ project: 'proj-1' });

        const response = await POST(request('POST', { scope: 'actor' }));
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(apiKeyMocks.issueToken).not.toHaveBeenCalled();
        expect(body.scope).toEqual({ current: { project: 'proj-1' }, requested: 'actor' });
        expect(body.remediation).toContain('current token boundary');
    });
});
