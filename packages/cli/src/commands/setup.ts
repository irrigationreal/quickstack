import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CliContext, optionValue } from '../lib/args';
import { emit, printError } from '../lib/output';

export async function setup(ctx: CliContext) {
  const url = optionValue('--url', ctx.commandArgs) || optionValue('--server', ctx.commandArgs);
  const apiKey = optionValue('--api-key', ctx.commandArgs) || optionValue('--token', ctx.commandArgs);
  if (!url || !apiKey) printError(ctx, 'Usage: quickstack setup --url <quickstack-url> --api-key <qstk_key>. Credentials are stored in ~/.quickstack/config.json, not in the project directory.');
  if (!/^qstk_/.test(apiKey)) printError(ctx, 'The API key should start with qstk_.');
  const configPath = process.env.QUICKSTACK_CONFIG || path.join(os.homedir(), '.quickstack', 'config.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify({ url: url.replace(/\/$/, ''), apiKey }, null, 2)}\n`, { mode: 0o600 });
  try { await fs.chmod(configPath, 0o600); } catch {}
  emit(ctx, 'success', { message: `QuickStack credentials saved to ${configPath}.`, configPath, url: url.replace(/\/$/, '') });
}
