import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function quickStackConfigPath() {
  return process.env.QUICKSTACK_CONFIG || path.join(os.homedir(), '.quickstack', 'config.json');
}

export async function readQuickStackConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(quickStackConfigPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function configString(config, key) {
  return typeof config?.[key] === 'string' ? config[key] : '';
}
