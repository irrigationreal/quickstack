const apiKeyMocks = vi.hoisted(() => ({ authenticateAuthorizationHeader: vi.fn(), hasScope: vi.fn(), isAllowedForApp: vi.fn() }));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const attachmentMocks = vi.hoisted(() => ({ listForApp: vi.fn(), attach: vi.fn(), detach: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanReadApp: vi.fn(), assertSessionCanWriteApp: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/service-attachment.service', () => ({ default: attachmentMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => authMocks);

import { GET } from './route';
import { POST as ATTACH } from './attach/route';
import { POST as DETACH } from './detach/route';

function request(url: string, body?: unknown) {
    return new Request(url, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer qstk_prefix_secret' }, body: body ? JSON.stringify(body) : undefined });
}

describe('agent managed services composition routes', () => {
    const app = { id: 'app-1', projectId: 'proj-1', name: 'App' };
    const service = { id: 'postgres-1', projectId: 'proj-1', name: 'Postgres', appType: 'POSTGRES' };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue({ session: { id: 'user-1' }, apiKey: { id: 'key-1' }, auditActor: { actorType: 'API_KEY', actorEmail: 'agent@example.com' } });
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockImplementation(async (id: string) => id === service.id ? service : app);
        attachmentMocks.listForApp.mockResolvedValue([{ appId: app.id, serviceId: service.id, family: 'postgres', injectedSecretKeys: ['DATABASE_URL'] }]);
        attachmentMocks.attach.mockResolvedValue({ appId: app.id, serviceId: service.id, attached: true });
        attachmentMocks.detach.mockResolvedValue({ appId: app.id, serviceId: service.id, detached: true });
    });

    it('lists attached managed services for an app', async () => {
        const response = await GET(request('http://quickstack.test/api/v1/agent/managed/services?appId=app-1'));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.services[0]).toEqual(expect.objectContaining({ serviceId: 'postgres-1', family: 'postgres' }));
    });

    it('authorizes both app and service when attaching', async () => {
        const response = await ATTACH(request('http://quickstack.test/api/v1/agent/managed/services/attach', { appId: 'app-1', serviceId: 'postgres-1' }));

        expect(response.status).toBe(200);
        expect(apiKeyMocks.isAllowedForApp).toHaveBeenCalledWith(expect.anything(), app);
        expect(apiKeyMocks.isAllowedForApp).toHaveBeenCalledWith(expect.anything(), service);
        expect(authMocks.assertSessionCanWriteApp).toHaveBeenCalledWith(expect.anything(), 'app-1');
        expect(authMocks.assertSessionCanWriteApp).toHaveBeenCalledWith(expect.anything(), 'postgres-1');
        expect(attachmentMocks.attach).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1', serviceId: 'postgres-1' }));
    });

    it('authorizes both app and service when detaching', async () => {
        const response = await DETACH(request('http://quickstack.test/api/v1/agent/managed/services/detach', { appId: 'app-1', serviceId: 'postgres-1' }));

        expect(response.status).toBe(200);
        expect(apiKeyMocks.isAllowedForApp).toHaveBeenCalledWith(expect.anything(), app);
        expect(apiKeyMocks.isAllowedForApp).toHaveBeenCalledWith(expect.anything(), service);
        expect(authMocks.assertSessionCanWriteApp).toHaveBeenCalledWith(expect.anything(), 'app-1');
        expect(authMocks.assertSessionCanWriteApp).toHaveBeenCalledWith(expect.anything(), 'postgres-1');
        expect(attachmentMocks.detach).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1', serviceId: 'postgres-1' }));
    });

    it('rejects attach when the user session cannot write the service app', async () => {
        authMocks.assertSessionCanWriteApp.mockImplementation((_session, appId) => {
            if (appId === service.id) throw new Error('no service access');
        });

        const response = await ATTACH(request('http://quickstack.test/api/v1/agent/managed/services/attach', { appId: 'app-1', serviceId: 'postgres-1' }));

        expect(response.status).toBe(403);
        expect(attachmentMocks.attach).not.toHaveBeenCalled();
    });

    it('rejects detach when token scope excludes the service app', async () => {
        apiKeyMocks.isAllowedForApp.mockImplementation((_key, candidate) => candidate.id !== service.id);

        const response = await DETACH(request('http://quickstack.test/api/v1/agent/managed/services/detach', { appId: 'app-1', serviceId: 'postgres-1' }));

        expect(response.status).toBe(403);
        expect(attachmentMocks.detach).not.toHaveBeenCalled();
    });
});
