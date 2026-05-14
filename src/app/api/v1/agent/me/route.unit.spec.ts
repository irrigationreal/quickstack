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

function request() {
    return new Request('http://quickstack.test/api/v1/agent/me', {
        method: 'GET',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
    });
}

describe('agent me route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
    };
    const projects = [
        { id: 'proj-1', name: 'Allowed', apps: [{ id: 'app-1', name: 'Web', projectId: 'proj-1', appType: 'APP', sourceType: 'CONTAINER' }] },
        { id: 'proj-2', name: 'Denied', apps: [{ id: 'app-2', name: 'Api', projectId: 'proj-2', appType: 'APP', sourceType: 'CONTAINER' }] },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        projectMocks.getAllProjects.mockResolvedValue(projects);
        roleMocks.sessionHasReadAccessToProject.mockImplementation((_session, projectId) => projectId === 'proj-1');
        roleMocks.sessionHasReadAccessForApp.mockReturnValue(true);
        apiKeyMocks.filterAllowedProjects.mockImplementation((_apiKey, inputProjects) => inputProjects);
    });

    it('returns normalized actor and project discovery output', async () => {
        const response = await GET(request());
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.actor).toEqual({ id: 'user-1', kind: 'agent', displayName: 'Claude agent', email: 'admin@example.com' });
        expect(body.projects).toEqual([{ id: 'proj-1', name: 'Allowed', ownerActorId: null, apps: [{ id: 'app-1', name: 'Web', projectId: 'proj-1', appType: 'APP', sourceType: 'CONTAINER' }] }]);
    });

    it('uses the shared API-key allowlist filter before returning projects', async () => {
        apiKeyMocks.filterAllowedProjects.mockReturnValue([]);

        const response = await GET(request());
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(apiKeyMocks.filterAllowedProjects).toHaveBeenCalledWith(authenticated.apiKey, [projects[0]]);
        expect(body.projects).toEqual([]);
    });

    it('rejects keys without apps read scope', async () => {
        apiKeyMocks.hasScope.mockReturnValue(false);

        const response = await GET(request());

        expect(response.status).toBe(403);
    });
});
