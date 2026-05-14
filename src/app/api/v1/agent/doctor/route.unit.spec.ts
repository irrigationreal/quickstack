const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const cliMocks = vi.hoisted(() => ({ listAvailableBinaries: vi.fn() }));
const strategyMocks = vi.hoisted(() => ({ getCapabilities: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/cli-distribution.service', () => ({ default: cliMocks }));
vi.mock('@/server/services/quickdeploy-build-strategy.service', () => ({ default: strategyMocks }));

describe('agent doctor route', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1', email: 'agent@example.com' }, apiKey: { id: 'key-1', name: 'Agent' } });
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'App' });
        cliMocks.listAvailableBinaries.mockReturnValue([{ version: '0.1.0', platform: 'darwin-arm64' }]);
        strategyMocks.getCapabilities.mockReturnValue({ strategies: ['source-tar', 'existing-image'], remoteBuilder: false });
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

    it('reports major version skew with reinstall remediation', async () => {
        const { GET } = await import('./route');
        const response = await GET(new Request('http://quickstack.test/api/v1/agent/doctor', { headers: { authorization: 'Bearer qstk_prefix_secret', 'X-QuickStack-CLI-Version': '9.0.0' } }));
        const body = await response.json();

        expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'version_skew', status: 'warning', remediation: expect.stringContaining('quickstack setup') })]));
    });
});
