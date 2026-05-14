const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn(), scopeForToken: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const cliMocks = vi.hoisted(() => ({ listAvailableBinaries: vi.fn() }));
const strategyMocks = vi.hoisted(() => ({ getCapabilities: vi.fn() }));
const quotaMocks = vi.hoisted(() => ({ getProjectQuotaDiagnostics: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/cli-distribution.service', () => ({ default: cliMocks }));
vi.mock('@/server/services/quickdeploy-build-strategy.service', () => ({ default: strategyMocks }));
vi.mock('@/server/services/security-quota.service', () => ({ default: quotaMocks }));

describe('agent doctor route', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1', email: 'agent@example.com' }, apiKey: { id: 'key-1', name: 'Agent' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        apiKeyMocks.scopeForToken.mockReturnValue('actor');
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        cliMocks.listAvailableBinaries.mockReturnValue([{ version: '0.1.0', platform: 'darwin-arm64' }]);
        strategyMocks.getCapabilities.mockReturnValue({ strategies: ['source-tar', 'existing-image'], remoteBuilder: false });
        quotaMocks.getProjectQuotaDiagnostics.mockResolvedValue({
            apps: { check: 'quota_apps', status: 'ok', code: 'quota.apps', message: 'No app quota warnings detected.' },
            volumes: { check: 'quota_volumes', status: 'ok', code: 'quota.volumes', message: 'No volume quota warnings detected.' },
            managedServices: { check: 'quota_managed_services', status: 'ok', code: 'quota.managed_services', message: 'No managed service quota warnings detected.' },
        });
    });

    it('reports auth ok', async () => {
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor', { headers: { authorization: 'Bearer qstk_prefix_secret', 'X-QuickStack-CLI-Version': '0.1.0' } }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'auth', status: 'ok' })]));
    });

    it('reports missing app visibility as an error', async () => {
        appMocks.getById.mockResolvedValue(null);
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor?appId=missing', { headers: { authorization: 'Bearer qstk_prefix_secret' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'app_visibility', status: 'error' })]));
    });

    it('reports token scope and quota warnings', async () => {
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor?quotaState=approaching', { headers: { authorization: 'Bearer qstk_prefix_secret' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ check: 'token_scope', status: 'ok', code: 'token.scope' }),
            expect.objectContaining({ check: 'quota_apps', status: 'warning', code: 'quota.apps' }),
        ]));
        expect(body.token.scope).toBe('actor');
    });

    it('reports missing command scopes with remediation', async () => {
        apiKeyMocks.hasScope.mockImplementation((_key, scope) => scope !== 'deploy:write');
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor', { headers: { authorization: 'Bearer qstk_prefix_secret' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ check: 'scope_deploy_write', status: 'error', code: 'scope.deploy:write', remediation: expect.stringContaining('deploy:write') }),
            expect.objectContaining({ check: 'scope_apps_read', status: 'ok', code: 'scope.apps:read' }),
        ]));
    });

    it('reports out-of-scope ownership context for a requested app', async () => {
        apiKeyMocks.isAllowedForApp.mockReturnValue(false);
        apiKeyMocks.scopeForToken.mockReturnValue({ project: 'proj-2' });
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor?appId=app-1', { headers: { authorization: 'Bearer qstk_prefix_secret' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'app_visibility', code: 'token.out_of_scope', message: expect.stringContaining('proj-1') })]));
    });

    it('reports expired tokens when auth context exposes an expired key', async () => {
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1', email: 'agent@example.com' }, apiKey: { id: 'key-1', name: 'Agent', expiresAt: new Date('2020-01-01T00:00:00Z') } });
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor', { headers: { authorization: 'Bearer qstk_prefix_secret' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'token_expired', status: 'error', code: 'token.expired' })]));
    });

    it('reports quota exceeded as a soft diagnostic error', async () => {
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor?quotaState=exceeded', { headers: { authorization: 'Bearer qstk_prefix_secret' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'quota_apps', status: 'error', code: 'quota.apps' })]));
    });

    it('reports major version skew with reinstall remediation', async () => {
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor', { headers: { authorization: 'Bearer qstk_prefix_secret', 'X-QuickStack-CLI-Version': '9.0.0' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'version_skew', status: 'warning', remediation: expect.stringContaining('quickstack setup') })]));
    });
});
