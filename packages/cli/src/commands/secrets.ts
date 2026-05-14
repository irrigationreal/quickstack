import fs from 'node:fs/promises';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { request } from '../lib/api-client';
import { emit, printError } from '../lib/output';

function parseDotenv(text: string) {
  const entries: { key: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    entries.push({ key, value });
  }
  return entries;
}
function looksSecret(key: string) { return /(TOKEN|SECRET|PASSWORD|PASS|KEY|DATABASE_URL|REDIS_URL|PRIVATE|CREDENTIAL|AUTH|REGISTRY)/i.test(key); }

export async function secrets(ctx: CliContext) {
  const sub = ctx.commandArgs[0];
  if (sub === 'import') {
    const dotenvPath = positionalArgs(ctx.commandArgs.slice(1))[0];
    const appId = optionValue('--app', ctx.commandArgs);
    if (!dotenvPath || !appId) printError(ctx, 'Usage: quickstack secrets import <.env> --app <appId> [--dry-run] [--json]');
    const rawEntries = parseDotenv(await fs.readFile(dotenvPath, 'utf8'));
    const secretsPayload = Object.fromEntries(rawEntries.filter(entry => looksSecret(entry.key)).map(entry => [entry.key, entry.value]));
    if (ctx.commandArgs.includes('--dry-run')) {
      emit(ctx, 'success', { message: `Would import ${Object.keys(secretsPayload).length} secret(s) for app ${appId}.`, appId, secretNames: Object.keys(secretsPayload).sort() });
      return;
    }
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/secrets`, { method: 'POST', body: JSON.stringify({ secrets: secretsPayload }) });
    emit(ctx, 'success', { message: `Imported ${Object.keys(secretsPayload).length} secret(s) for app ${appId}. Public env keys were not changed by this command.`, appId, secretNames: Object.keys(secretsPayload).sort(), result });
    return;
  }
  if (sub === 'set') {
    const appId = optionValue('--app', ctx.commandArgs);
    const fromEnv = optionValue('--from-env', ctx.commandArgs);
    const fromFile = optionValue('--from-file', ctx.commandArgs);
    if (!appId || (!fromEnv && !fromFile)) printError(ctx, 'Usage: quickstack secrets set --app <appId> (--from-env KEY|--from-file KEY=path)');
    let name = fromEnv || '';
    let value = fromEnv ? process.env[fromEnv] : undefined;
    if (fromFile) {
      const equals = fromFile.indexOf('=');
      if (equals <= 0) printError(ctx, 'Use --from-file KEY=path.');
      name = fromFile.slice(0, equals);
      value = await fs.readFile(fromFile.slice(equals + 1), 'utf8');
    }
    if (value === undefined) printError(ctx, `Environment variable ${fromEnv} is not set.`);
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/secrets`, { method: 'POST', body: JSON.stringify({ secrets: { [name]: value } }) });
    emit(ctx, 'success', { message: `Set secret ${name} for app ${appId}.`, appId, secretNames: [name], result });
    return;
  }
  if (sub === 'list') {
    const appId = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
    if (!appId) printError(ctx, 'Usage: quickstack secrets list --app <appId>');
    const result = await request(`/api/v1/agent/apps/${encodeURIComponent(appId)}/secrets`);
    emit(ctx, 'success', { message: `Listed ${result.secrets?.length ?? 0} secret(s). Values are never returned.`, appId, secrets: result.secrets });
    return;
  }
  printError(ctx, 'Usage: quickstack secrets <import|set|list|unset> ...');
}
