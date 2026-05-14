import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface DiscoveryCache {
  lastActor?: { id: string; displayName?: string; email?: string };
  lastProjectId?: string;
  lastAppId?: string;
}

export interface LocalState {
  index: (DiscoveryCache & Record<string, any>) | null;
  apps: any[];
}

export function quickStackConfigPath() {
  return process.env.QUICKSTACK_CONFIG || path.join(os.homedir(), '.quickstack', 'config.json');
}

export async function readQuickStackConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(quickStackConfigPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function configString(config: Record<string, unknown>, key: string) {
  return typeof config?.[key] === 'string' ? config[key] as string : '';
}

export async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function readFirstExisting(root: string, relative: string) {
  const quickstack = await readJson(path.join(root, '.quickstack', relative));
  if (quickstack) return quickstack;
  return readJson(path.join(root, '.quickdeploy', relative));
}

export async function readProjectState(root: string): Promise<LocalState> {
  const index = await readFirstExisting(root, 'index.json');
  const apps: any[] = [];
  for (const stateDir of ['.quickstack', '.quickdeploy']) {
    const appsDir = path.join(root, stateDir, 'apps');
    try {
      const entries = await fs.readdir(appsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const app = await readJson(path.join(appsDir, entry.name));
          if (app && !apps.some(existing => existing.appId === app.appId || existing.id === app.id)) apps.push(app);
        }
      }
    } catch {
      // no state yet
    }
    if (apps.length > 0 && stateDir === '.quickstack') break;
  }
  return { index, apps };
}

export async function writeProjectApp(root: string, app: any) {
  await writeJson(path.join(root, '.quickstack', 'apps', `${app.appId || app.id}.json`), app);
}

export async function writeProjectIndex(root: string, index: any) {
  await writeJson(path.join(root, '.quickstack', 'index.json'), index);
}

export function selectStateForPath(state: LocalState, root: string, cwd = process.cwd(), appId?: string) {
  const relCwd = path.relative(root, cwd) || '.';
  if (appId) return state.apps.find(app => app.appId === appId || app.id === appId);
  const matching = state.apps.filter(app => app.serviceRoot === relCwd || (relCwd !== '.' && relCwd.startsWith(`${app.serviceRoot}/`)));
  return matching.length === 1 ? matching[0] : undefined;
}
