import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const apiMocks = vi.hoisted(() => ({
  deployImage: vi.fn(),
  getAppConfig: vi.fn(),
  getMe: vi.fn(),
  request: vi.fn(),
  listTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  updateChecks: vi.fn(),
}));
const appMocks = vi.hoisted(() => ({ resolveApp: vi.fn() }));
const buildMocks = vi.hoisted(() => ({ executeBuildStrategy: vi.fn() }));
const planMocks = vi.hoisted(() => ({ createPlan: vi.fn() }));

vi.mock('../../packages/cli/src/lib/api-client', () => apiMocks);
vi.mock('../../packages/cli/src/commands/apps', () => appMocks);
vi.mock('../../packages/cli/src/commands/build', () => buildMocks);
vi.mock('../../packages/cli/src/commands/plan', () => planMocks);

import { checks } from '../../packages/cli/src/commands/checks';
import { config } from '../../packages/cli/src/commands/config';
import { deploy } from '../../packages/cli/src/commands/deploy';
import { destroy } from '../../packages/cli/src/commands/destroy';
import { exec } from '../../packages/cli/src/commands/exec';
import { launch } from '../../packages/cli/src/commands/launch';
import { tokens } from '../../packages/cli/src/commands/tokens';

const ctx = (command: string, commandArgs: string[], json = true) => ({ command, commandArgs, globalArgs: [], json, nonInteractive: true });

async function tempProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quickstack-cli-test-'));
  await fs.mkdir(path.join(root, '.quickstack', 'apps'), { recursive: true });
  return root;
}

describe('quickstack lifecycle CLI contracts', () => {
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    apiMocks.getMe.mockResolvedValue({ actor: { id: 'user-1', kind: 'agent', displayName: 'Agent' }, projects: [{ id: 'proj-1', name: 'Team', ownerActorId: 'user-1' }] });
    apiMocks.request.mockImplementation(async (requestPath: string) => requestPath === '/api/v1/agent/apps/ensure' ? { appId: 'app-1' } : { status: 'success' });
    apiMocks.deployImage.mockResolvedValue({ status: 'success', deploymentId: 'deploy-1' });
    apiMocks.getAppConfig.mockResolvedValue({ appId: 'app-1', projectId: 'proj-1', config: { app: { id: 'app-1', name: 'Demo' }, env: [{ name: 'PUBLIC_URL', value: 'https://example.com' }], secrets: [{ name: 'DATABASE_URL' }] } });
    appMocks.resolveApp.mockResolvedValue({ id: 'app-1', name: 'Demo', projectId: 'proj-1' });
    buildMocks.executeBuildStrategy.mockResolvedValue({ buildResult: { image: { registry: 'registry.example.com', repository: 'demo', tag: 'v1' }, imageReference: 'registry.example.com/demo:v1', strategy: 'source-tar', sourceProvenance: '.', cacheHit: false } });
    planMocks.createPlan.mockResolvedValue({ plan: { framework: 'node', serviceRoot: '.', buildStrategies: [{ strategy: 'source-tar' }], questions: [], warnings: [], evidence: [], ports: [3000] } });
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('launches with the only visible project when --project is omitted', async () => {
    const root = await tempProject();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await launch(ctx('launch', [root]));

    expect(apiMocks.request).toHaveBeenCalledWith('/api/v1/agent/apps/ensure', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"projectId":"proj-1"'),
    }));
    expect(buildMocks.executeBuildStrategy).toHaveBeenCalledWith(expect.anything(), 'app-1', root, 'proj-1', 'source-tar');
    expect(apiMocks.deployImage).toHaveBeenCalledWith('app-1', expect.objectContaining({ strategy: 'source-tar' }));
    log.mockRestore();
  });

  it('treats quickstack deploy <path> as a repo path, resolves local state, and records build strategy metadata', async () => {
    const root = await tempProject();
    await fs.writeFile(path.join(root, '.quickstack', 'apps', 'app-1.json'), JSON.stringify({ appId: 'app-1', projectId: 'proj-1', serviceRoot: '.' }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await deploy(ctx('deploy', [root]));

    expect(appMocks.resolveApp).not.toHaveBeenCalled();
    expect(buildMocks.executeBuildStrategy).toHaveBeenCalledWith(expect.anything(), 'app-1', root);
    expect(apiMocks.deployImage).toHaveBeenCalledWith('app-1', expect.objectContaining({ strategy: 'source-tar' }));
    expect(apiMocks.request).not.toHaveBeenCalledWith('/api/v1/agent/apps/app-1/deploy', { method: 'POST' });
    log.mockRestore();
  });

  it('deploys a monorepo app from repo root when one cached app has a nested service root', async () => {
    const root = await tempProject();
    await fs.mkdir(path.join(root, 'packages', 'web'), { recursive: true });
    await fs.writeFile(path.join(root, '.quickstack', 'apps', 'app-1.json'), JSON.stringify({ appId: 'app-1', projectId: 'proj-1', serviceRoot: 'packages/web' }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await deploy(ctx('deploy', [root]));

    expect(buildMocks.executeBuildStrategy).toHaveBeenCalledWith(expect.anything(), 'app-1', root);
    expect(apiMocks.deployImage).toHaveBeenCalledWith('app-1', expect.objectContaining({ strategy: 'source-tar' }));
    log.mockRestore();
  });

  it('deploys a nested monorepo service path by discovering the project root', async () => {
    const root = await tempProject();
    const serviceRoot = path.join(root, 'packages', 'web');
    await fs.mkdir(serviceRoot, { recursive: true });
    await fs.writeFile(path.join(root, '.quickstack', 'apps', 'app-1.json'), JSON.stringify({ appId: 'app-1', projectId: 'proj-1', serviceRoot: 'packages/web' }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await deploy(ctx('deploy', [serviceRoot]));

    expect(buildMocks.executeBuildStrategy).toHaveBeenCalledWith(expect.anything(), 'app-1', root);
    expect(apiMocks.deployImage).toHaveBeenCalledWith('app-1', expect.objectContaining({ strategy: 'source-tar' }));
    log.mockRestore();
  });

  it('resolves quickstack exec <path> from local state', async () => {
    const root = await tempProject();
    const serviceRoot = path.join(root, 'packages', 'web');
    await fs.mkdir(serviceRoot, { recursive: true });
    await fs.writeFile(path.join(root, '.quickstack', 'apps', 'app-1.json'), JSON.stringify({ appId: 'app-1', projectId: 'proj-1', serviceRoot: 'packages/web' }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await exec(ctx('exec', [serviceRoot, '--', 'echo', 'hello']));

    expect(appMocks.resolveApp).not.toHaveBeenCalled();
    expect(apiMocks.request).toHaveBeenCalledWith('/api/v1/agent/apps/app-1/exec', expect.objectContaining({ method: 'POST' }));
    log.mockRestore();
  });

  it('refuses non-interactive destroy without --yes before live app resolution', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(destroy(ctx('destroy', ['demo'], true))).rejects.toThrow('exit:2');

    expect(appMocks.resolveApp).not.toHaveBeenCalled();
    exit.mockRestore();
    log.mockRestore();
  });

  it('pulls canonical server config into local state with secret values masked', async () => {
    const root = await tempProject();
    process.chdir(root);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await config(ctx('config', ['pull', 'demo']));

    const saved = JSON.parse(await fs.readFile(path.join(root, '.quickstack', 'apps', 'app-1.json'), 'utf8'));
    expect(saved.config.app.name).toBe('Demo');
    expect(saved.config.env[0]).toEqual({ name: 'PUBLIC_URL', value: '***' });
    expect(saved.config.secrets[0]).toEqual({ name: 'DATABASE_URL' });
    log.mockRestore();
  });

  it('validates pulled config with secret metadata but no secret values', async () => {
    const root = await tempProject();
    process.chdir(root);
    await fs.writeFile(path.join(root, '.quickstack', 'apps', 'app-1.json'), JSON.stringify({ appId: 'app-1', config: { secrets: [{ name: 'DATABASE_URL' }], env: [{ name: 'PUBLIC_URL', value: '***' }] } }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await config(ctx('config', ['validate']));

    expect(JSON.parse(log.mock.calls[0][0]).outcome).toBe('ok');
    log.mockRestore();
  });

  it('rejects check updates without the required port', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(checks(ctx('checks', ['update', 'demo', '--path', '/ready']))).rejects.toThrow('exit:2');

    expect(apiMocks.updateChecks).not.toHaveBeenCalled();
    exit.mockRestore();
    log.mockRestore();
  });

  it('prints token plaintext only on create and masks list output to prefixes', async () => {
    apiMocks.createToken.mockResolvedValue({ token: { id: 'token-1', prefix: 'qstk_abc…', scope: { project: 'proj-1' }, issuedAt: '2026-05-14T00:00:00Z', issuedByActorId: 'user-1' }, plaintextToken: 'qstk_abc_secret', notice: 'Save this token; it will not be shown again.' });
    apiMocks.listTokens.mockResolvedValue({ status: 'success', tokens: [{ id: 'token-1', prefix: 'qstk_abc…', scope: { project: 'proj-1' }, issuedAt: '2026-05-14T00:00:00Z', issuedByActorId: 'user-1' }] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await tokens(ctx('tokens', ['create', '--scope', 'project:proj-1']));
    const created = JSON.parse(log.mock.calls.at(-1)![0]);
    await tokens(ctx('tokens', ['list']));
    const listed = JSON.parse(log.mock.calls.at(-1)![0]);

    expect(created.plaintextToken).toBe('qstk_abc_secret');
    expect(created.notice).toContain('will not be shown again');
    expect(JSON.stringify(listed.tokens)).toContain('qstk_abc…');
    expect(JSON.stringify(listed.tokens)).not.toContain('secret');
    log.mockRestore();
  });
});
