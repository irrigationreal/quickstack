import fs from 'node:fs/promises';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { listSecrets, updateSecrets } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

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
    const appArg = optionValue('--app', ctx.commandArgs);
    if (!dotenvPath || !appArg) printError(ctx, 'Usage: quickstack secrets import <.env> --app <app> [--dry-run] [--json]');
    const appId = (await resolveApp(appArg)).id;
    const rawEntries = parseDotenv(await fs.readFile(dotenvPath, 'utf8'));
    const secretsPayload = Object.fromEntries(rawEntries.filter(entry => looksSecret(entry.key)).map(entry => [entry.key, entry.value]));
    if (ctx.commandArgs.includes('--dry-run')) {
      emit(ctx, 'success', { message: `Would import ${Object.keys(secretsPayload).length} secret(s) for app ${appId}.`, appId, secretNames: Object.keys(secretsPayload).sort() });
      return;
    }
    const result = await updateSecrets(appId, { secrets: secretsPayload });
    emit(ctx, 'success', { message: `Imported ${Object.keys(secretsPayload).length} secret(s) for app ${appId}. Public env keys were not changed by this command.`, appId, secretNames: Object.keys(secretsPayload).sort(), secrets: result.secrets });
    return;
  }
  if (sub === 'set') {
    const appArg = optionValue('--app', ctx.commandArgs);
    const appId = appArg ? (await resolveApp(appArg)).id : undefined;
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
    const result = await updateSecrets(appId, { secrets: { [name]: value } });
    emit(ctx, 'success', { message: `Set secret ${name} for app ${appId}.`, appId, secretNames: [name], secrets: result.secrets });
    return;
  }
  if (sub === 'list') {
    const appArg = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
    if (!appArg) printError(ctx, 'Usage: quickstack secrets list --app <app>');
    const appId = (await resolveApp(appArg)).id;
    const result = await listSecrets(appId);
    emit(ctx, 'success', { message: `Listed ${result.secrets?.length ?? 0} secret(s). Values are never returned.`, appId, secrets: result.secrets });
    return;
  }
  if (sub === 'unset' || sub === 'remove' || sub === 'rm') {
    const appArg = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
    const name = ctx.commandArgs.find((arg, index) => index > 0 && !arg.startsWith('-') && arg !== appArg);
    if (!appArg || !name) printError(ctx, 'Usage: quickstack secrets unset --app <app> <KEY> [--json]');
    const appId = (await resolveApp(appArg)).id;
    const result = await updateSecrets(appId, { unset: [name] });
    emit(ctx, 'success', { message: `Unset secret ${name} for app ${appId}.`, appId, secrets: result.secrets });
    return;
  }
  if (sub === 'diff' || sub === 'sync') {
    const appArg = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
    const dotenvPath = optionValue('--from', ctx.commandArgs) || positionalArgs(ctx.commandArgs.slice(1)).find(arg => arg !== appArg) || '.env';
    if (!appArg) printError(ctx, `Usage: quickstack secrets ${sub} --app <app> [--from <.env>] [--prune] [--dry-run] [--json]`);
    const appId = (await resolveApp(appArg)).id;
    const rawEntries = parseDotenv(await fs.readFile(dotenvPath, 'utf8'));
    const localSecretNames = rawEntries.filter(entry => looksSecret(entry.key)).map(entry => entry.key).sort();
    const localSecretSet = new Set(localSecretNames);
    const localSecretPayload = Object.fromEntries(rawEntries.filter(entry => localSecretSet.has(entry.key)).map(entry => [entry.key, entry.value]));
    const remote = await listSecrets(appId);
    const remoteNames = (remote.secrets || []).map(secret => secret.name).sort();
    const remoteSet = new Set(remoteNames);
    const toCreateOrUpdate = localSecretNames;
    const remoteOnly = remoteNames.filter(name => !localSecretSet.has(name));
    const missingRemote = localSecretNames.filter(name => !remoteSet.has(name));
    const unset = ctx.commandArgs.includes('--prune') ? remoteOnly : [];
    const message = `Secret diff for ${appId}: ${missingRemote.length} missing remotely, ${remoteOnly.length} only on server. Values are never read or printed.`;
    if (sub === 'diff' || ctx.commandArgs.includes('--dry-run')) {
      emit(ctx, 'success', { message, appId, localSecretNames, remoteSecretNames: remoteNames, toCreateOrUpdate, missingRemote, remoteOnly, unsetNames: unset });
      return;
    }
    const result = await updateSecrets(appId, { secrets: localSecretPayload, unset });
    emit(ctx, 'success', { message: `Synced ${toCreateOrUpdate.length} secret name(s) for ${appId}. Values were sent but are not returned.`, appId, secretNames: result.secrets.map(secret => secret.name).sort(), setNames: toCreateOrUpdate, unsetNames: unset });
    return;
  }
  printError(ctx, 'Usage: quickstack secrets <import|set|list|unset|diff|sync> ...');
}
