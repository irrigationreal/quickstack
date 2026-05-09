const apiKeyMocks = vi.hoisted(() => ({
    authenticateAuthorizationHeader: vi.fn(),
    hasScope: vi.fn(),
    isAllowedForApp: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({ getById: vi.fn() }));
const podMocks = vi.hoisted(() => ({ getPodsForApp: vi.fn() }));
const auditMocks = vi.hoisted(() => ({ recordBestEffort: vi.fn() }));
const authMocks = vi.hoisted(() => ({ assertSessionCanWriteApp: vi.fn() }));
const execMocks = vi.hoisted(() => ({ exec: vi.fn() }));

vi.mock('@/server/services/api-key.service', () => ({ default: apiKeyMocks }));
vi.mock('@/server/services/app.service', () => ({ default: appMocks }));
vi.mock('@/server/services/pod.service', () => ({ default: podMocks }));
vi.mock('@/server/services/audit.service', () => ({ default: auditMocks }));
vi.mock('@/server/utils/action-wrapper.utils', () => ({ assertSessionCanWriteApp: authMocks.assertSessionCanWriteApp }));
vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({ default: { getKubeConfig: vi.fn(() => ({})) } }));
vi.mock('@kubernetes/client-node', () => ({
    Exec: class {
        exec = execMocks.exec;
    },
}));

import { POST } from './route';

function request(body: Record<string, unknown>) {
    return new Request('http://quickstack.test/api/v1/agent/apps/app-1/exec', {
        method: 'POST',
        headers: { authorization: 'Bearer qstk_prefix_secret' },
        body: JSON.stringify(body),
    });
}

describe('agent app exec route', () => {
    const authenticated = {
        session: { id: 'user-1', email: 'admin@example.com', userGroup: { name: 'admin', id: 'group-1', canAccessBackups: true, roleProjectPermissions: [] } },
        apiKey: { id: 'key-1', name: 'Claude agent' },
        auditActor: { actorType: 'API_KEY', actorUserId: 'user-1', actorEmail: 'admin@example.com', apiKeyId: 'key-1', apiKeyName: 'Claude agent' },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyMocks.authenticateAuthorizationHeader.mockResolvedValue(authenticated);
        apiKeyMocks.hasScope.mockReturnValue(true);
        apiKeyMocks.isAllowedForApp.mockReturnValue(true);
        appMocks.getById.mockResolvedValue({ id: 'app-1', projectId: 'proj-1', name: 'Demo App' });
        podMocks.getPodsForApp.mockResolvedValue([{ podName: 'pod-1', containerName: 'app-1', status: 'Running' }]);
        execMocks.exec.mockImplementation((_namespace, _pod, _container, _command, stdout, _stderr, _stdin, _tty, callback) => {
            stdout.write('hello\n');
            callback({ status: 'Success' });
            return Promise.resolve();
        });
    });

    it('execs a command in the running app pod and returns stdout', async () => {
        const response = await POST(request({ command: ['cat', '/etc/os-release'] }), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(execMocks.exec).toHaveBeenCalledWith('proj-1', 'pod-1', 'app-1', ['cat', '/etc/os-release'], expect.anything(), expect.anything(), null, false, expect.any(Function));
        expect(json.stdout).toBe('hello\n');
        expect(json.exitCode).toBe(0);
    });

    it('preserves non-zero exit codes for the CLI to propagate', async () => {
        execMocks.exec.mockImplementation((_namespace, _pod, _container, _command, _stdout, stderr, _stdin, _tty, callback) => {
            stderr.write('nope\n');
            callback({ status: 'Failure', details: { causes: [{ reason: 'ExitCode', message: '7' }] } });
            return Promise.resolve();
        });

        const response = await POST(request({ command: ['false'] }), { params: Promise.resolve({ appId: 'app-1' }) });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.status).toBe('error');
        expect(json.stderr).toBe('nope\n');
        expect(json.exitCode).toBe(7);
    });
});
