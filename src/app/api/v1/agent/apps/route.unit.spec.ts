const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    filterAllowedProjects: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({ getAllProjects: vi.fn() }));
const roleMocks = vi.hoisted(() => ({
    sessionHasReadAccessToProject: vi.fn(),
    sessionHasReadAccessForApp: vi.fn(),
}));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/project.service', () => ({ default: projectMocks }));
vi.mock('@/shared/utils/role.utils', () => ({ UserGroupUtils: roleMocks }));

import { GET } from './route';

function request(path = 'http://quickstack.test/api/v1/agent/apps') {
    return new Request(path, {
        method: 'GET',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
    });
}

describe('agent apps route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
    };
    const projects = [
        { id: 'proj-1', name: 'One', apps: [{ id: 'app-1', name: 'Web', projectId: 'proj-1', replicas: 1, updatedAt: new Date('2026-05-13T12:00:00Z') }] },
        { id: 'proj-2', name: 'Two', apps: [{ id: 'app-2', name: 'Worker', projectId: 'proj-2', replicas: 0, updatedAt: new Date('2026-05-13T13:00:00Z') }] },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        projectMocks.getAllProjects.mockResolvedValue(projects);
        roleMocks.sessionHasReadAccessToProject.mockReturnValue(true);
        roleMocks.sessionHasReadAccessForApp.mockReturnValue(true);
        apiKeyMocks.filterAllowedProjects.mockImplementation((_apiKey, inputProjects) => inputProjects);
    });

    it('returns a flat scoped app list', async () => {
        const response = await GET(request());
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.apps).toEqual([
            { id: 'app-1', projectId: 'proj-1', name: 'Web', status: 'running', lastDeployedAt: '2026-05-13T12:00:00.000Z' },
            { id: 'app-2', projectId: 'proj-2', name: 'Worker', status: 'stopped', lastDeployedAt: '2026-05-13T13:00:00.000Z' },
        ]);
    });

    it('filters by projectId server-side', async () => {
        const response = await GET(request('http://quickstack.test/api/v1/agent/apps?projectId=proj-2'));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.apps).toEqual([{ id: 'app-2', projectId: 'proj-2', name: 'Worker', status: 'stopped', lastDeployedAt: '2026-05-13T13:00:00.000Z' }]);
    });

    it('returns an empty list when no allowed app remains', async () => {
        apiKeyMocks.filterAllowedProjects.mockReturnValue([{ ...projects[0], apps: [] }]);

        const response = await GET(request());
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.apps).toEqual([]);
    });

    it('rejects keys without apps read scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await GET(request());

        expect(response.status).toBe(403);
    });
});
