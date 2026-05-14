import fs from 'node:fs/promises';
import path from 'node:path';
import { CliContext, optionValue } from '../lib/args';
import { emit, printError } from '../lib/output';
import { quickStackConfigPath } from '../lib/state';

export async function setup(ctx: CliContext) {
  const url = optionValue('--url', ctx.commandArgs) || optionValue('--server', ctx.commandArgs);
  const apiKey = optionValue('--api-key', ctx.commandArgs) || optionValue('--token', ctx.commandArgs);
  if (!url || !apiKey) printError(ctx, 'Usage: quickstack setup --url <quickstack-url> --api-key <qstk_key> [--registry-ssh-host user@host] [--registry-ssh-remote-host host] [--registry-ssh-remote-port port] [--registry-local-url host:port]. Credentials are stored in ~/.quickstack/config.json, not in the project directory.');
  if (!/^qstk_/.test(apiKey)) printError(ctx, 'The API key should start with qstk_.');
  const registrySshHost = optionValue('--registry-ssh-host', ctx.commandArgs);
  const registrySshRemoteHost = optionValue('--registry-ssh-remote-host', ctx.commandArgs);
  const registrySshRemotePort = optionValue('--registry-ssh-remote-port', ctx.commandArgs);
  const registryLocalUrl = optionValue('--registry-local-url', ctx.commandArgs);
  const configPath = quickStackConfigPath();
  const config = {
    url: url.replace(/\/$/, ''),
    apiKey,
    ...(registrySshHost ? { registrySshHost } : {}),
    ...(registrySshRemoteHost ? { registrySshRemoteHost } : {}),
    ...(registrySshRemotePort ? { registrySshRemotePort } : {}),
    ...(registryLocalUrl ? { registryLocalUrl } : {}),
  };
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try { await fs.chmod(configPath, 0o600); } catch {}
  emit(ctx, 'success', { message: `QuickStack credentials saved to ${configPath}.`, configPath, url: url.replace(/\/$/, '') });
}
