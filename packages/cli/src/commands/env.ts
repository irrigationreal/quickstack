import fs from 'node:fs/promises';
import { CliContext, optionValue, positionalArgs } from '../lib/args';
import { getEnv, updateEnv } from '../lib/api-client';
import { emit, printError } from '../lib/output';
import { resolveApp } from './apps';

function parseAssignment(value: string | undefined) {
  if (!value) return undefined;
  const equals = value.indexOf('=');
  if (equals <= 0) return undefined;
  return { name: value.slice(0, equals), value: value.slice(equals + 1) };
}

function parseDotenv(text: string) {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const name = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[name] = value;
  }
  return env;
}

function secretLike(name: string) {
  return /(TOKEN|SECRET|PASSWORD|PASS|KEY|DATABASE_URL|REDIS_URL|PRIVATE|CREDENTIAL|AUTH|REGISTRY)/i.test(name);
}

function validEnvName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export async function env(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  const appArg = optionValue('--app', ctx.commandArgs) || ctx.commandArgs[1];
  if (!['list', 'set', 'unset', 'sync', 'diff'].includes(sub) || !appArg) {
    printError(ctx, 'Usage: quickstack env <list|set|unset|sync|diff> <app> [KEY=VALUE|KEY] [--from <.env>] [--value <value>] [--json]');
  }
  const app = await resolveApp(appArg);
  const appId = app.id;

  if (sub === 'list') {
    const result = await getEnv(appId);
    emit(ctx, 'success', { message: `Listed ${result.env.length} public env var(s).`, appId, env: result.env });
    return;
  }

  if (sub === 'set') {
    const assignment = parseAssignment(ctx.commandArgs[2]);
    const name = assignment?.name || optionValue('--name', ctx.commandArgs);
    const value = assignment?.value ?? optionValue('--value', ctx.commandArgs);
    if (!name || value === undefined) printError(ctx, 'Usage: quickstack env set <app> KEY=VALUE [--json]');
    if (secretLike(name) && !ctx.commandArgs.includes('--force')) {
      printError(ctx, `Refusing to store secret-looking key ${name} as public env. Use quickstack secrets set or pass --force.`, 2);
    }
    const result = await updateEnv(appId, { env: { [name]: value } });
    emit(ctx, 'success', { message: `Set public env ${name} for ${appId}. Redeploy the app for the change to become active.`, appId, env: result.env });
    return;
  }

  if (sub === 'sync' || sub === 'diff') {
    const dotenvPath = optionValue('--from', ctx.commandArgs) || '.env';
    const local = parseDotenv(await fs.readFile(dotenvPath, 'utf8'));
    const skippedSecretLike = Object.keys(local).filter(secretLike).sort();
    const invalidNames = Object.keys(local).filter(name => !validEnvName(name)).sort();
    const envPayload = Object.fromEntries(Object.entries(local).filter(([name]) => validEnvName(name) && (!secretLike(name) || ctx.commandArgs.includes('--force'))));
    const remote = await getEnv(appId);
    const localNames = new Set(Object.keys(envPayload));
    const unset = remote.env.map(entry => entry.name).filter(name => !localNames.has(name));
    const warnings = [
      ...(!ctx.commandArgs.includes('--force') && skippedSecretLike.length ? [`Skipped secret-looking key(s): ${skippedSecretLike.join(', ')}. Use quickstack secrets sync or pass --force.`] : []),
      ...(invalidNames.length ? [`Skipped invalid env name(s): ${invalidNames.join(', ')}.`] : []),
    ];
    if (sub === 'diff' || ctx.commandArgs.includes('--dry-run')) {
      emit(ctx, 'success', { message: `Env diff for ${appId}: ${Object.keys(envPayload).length} local public env var(s), ${unset.length} only on server.`, appId, localNames: Object.keys(envPayload).sort(), remoteNames: remote.env.map(entry => entry.name).sort(), setNames: Object.keys(envPayload).sort(), unsetNames: unset.sort(), warnings });
      return;
    }
    const result = await updateEnv(appId, { env: envPayload, unset });
    emit(ctx, 'success', { message: `Synced ${Object.keys(envPayload).length} public env var(s) for ${appId}. Redeploy the app for the change to become active.`, appId, env: result.env, setNames: Object.keys(envPayload).sort(), unsetNames: unset.sort(), warnings });
    return;
  }

  const name = ctx.commandArgs[2] || optionValue('--name', ctx.commandArgs);
  if (!name) printError(ctx, 'Usage: quickstack env unset <app> <KEY> [--json]');
  const result = await updateEnv(appId, { unset: [name] });
  emit(ctx, 'success', { message: `Unset public env ${name} for ${appId}. Redeploy the app for the change to become active.`, appId, env: result.env });
}
