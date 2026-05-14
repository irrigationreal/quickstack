const apiMocks = vi.hoisted(() => ({ streamExec: vi.fn() }));
const appMocks = vi.hoisted(() => ({ resolveApp: vi.fn() }));

vi.mock('../../packages/cli/src/lib/api-client', () => apiMocks);
vi.mock('../../packages/cli/src/commands/apps', () => appMocks);

import { ssh } from '../../packages/cli/src/commands/ssh';

describe('quickstack ssh command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appMocks.resolveApp.mockResolvedValue({ id: 'app-1', name: 'App' });
    apiMocks.streamExec.mockResolvedValue({
      completion: Promise.resolve({ exitCode: 0 }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello\n'));
          controller.close();
        },
      }),
    });
  });

  it('runs -- commands through the exec stream surface and returns streamed output in json mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await ssh({ command: 'ssh', commandArgs: ['my-app', '--', 'echo', 'hello'], globalArgs: [], json: true, nonInteractive: true });

    expect(appMocks.resolveApp).toHaveBeenCalledWith('my-app');
    expect(apiMocks.streamExec).toHaveBeenCalledWith('app-1', { command: ['echo', 'hello'], tty: false }, null);
    const envelope = JSON.parse(log.mock.calls[0][0]);
    expect(envelope.outcome).toBe('ok');
    expect(envelope.stdout).toBe('hello\n');
    expect(envelope.exitCode).toBe(0);

    log.mockRestore();
  });

  it('streams quickstack ssh <app> -- <command> output to stdout and exits with the remote code', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    });

    await expect(ssh({ command: 'ssh', commandArgs: ['my-app', '--', 'echo', 'hello'], globalArgs: [], json: false, nonInteractive: true })).rejects.toThrow('exit:0');

    expect(apiMocks.streamExec).toHaveBeenCalledWith('app-1', { command: ['echo', 'hello'], tty: false }, null);
    expect(stdout.mock.calls.map(call => String(call[0])).join('')).toContain('hello\n');

    stdout.mockRestore();
    exit.mockRestore();
  });

  it('exits non-zero in json mode when the remote command fails', async () => {
    apiMocks.streamExec.mockResolvedValue({
      completion: Promise.resolve({ exitCode: 7 }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('failed\n'));
          controller.close();
        },
      }),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    });

    await expect(ssh({ command: 'ssh', commandArgs: ['my-app', '--', 'false'], globalArgs: [], json: true, nonInteractive: true })).rejects.toThrow('exit:7');

    const envelope = JSON.parse(log.mock.calls[0][0]);
    expect(envelope.outcome).toBe('error');
    expect(envelope.stdout).toBe('failed\n');
    expect(envelope.exitCode).toBe(7);

    log.mockRestore();
    exit.mockRestore();
  });
});
