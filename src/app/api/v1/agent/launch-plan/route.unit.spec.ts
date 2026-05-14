const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
}));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));

import { POST } from './route';

function request(body: unknown) {
    return new Request('http://quickstack.test/api/v1/agent/launch-plan', {
        method: 'POST',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: JSON.stringify(body),
    });
}

describe('agent launch plan route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com' },
        apiKey: { id: 'key-1', name: 'Claude agent' },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
    });

    it('returns required questions for ambiguous inputs', async () => {
        const response = await POST(request({ evidence: [
            { kind: 'service-root', sourcePath: 'apps/web/package.json', reason: 'package root', value: 'apps/web' },
            { kind: 'service-root', sourcePath: 'apps/api/package.json', reason: 'package root', value: 'apps/api' },
        ] }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.questions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'service-root' })]));
    });

    it('returns capability warnings when remote builder is requested but unavailable', async () => {
        const response = await POST(request({ flags: { remoteBuilder: true }, evidence: [] }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.warnings).toEqual([{ code: 'remote-builder-unavailable', message: 'Remote builder was requested, but this server does not advertise remote-builder capability yet.' }]);
    });

    it('returns a Dockerfile happy-path plan', async () => {
        const response = await POST(request({ evidence: [
            { kind: 'service-root', sourcePath: 'package.json', reason: 'root package', value: '.' },
            { kind: 'dockerfile', sourcePath: 'Dockerfile', reason: 'Dockerfile exists', value: 'Dockerfile' },
            { kind: 'port', sourcePath: 'Dockerfile', reason: 'EXPOSE 8080', value: 8080 },
        ] }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.serviceRoot).toBe('.');
        expect(body.ports).toEqual([8080]);
        expect(body.buildStrategies[0].strategy).toBe('source-tar');
        expect(body.questions).toEqual([]);
    });
});
