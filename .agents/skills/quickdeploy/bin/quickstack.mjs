#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const command = argv.find(arg => !arg.startsWith('-'));
const commandIndex = command ? argv.indexOf(command) : -1;
const commandArgs = commandIndex >= 0 ? argv.slice(commandIndex + 1) : [];
const globalArgs = commandIndex >= 0 ? argv.slice(0, commandIndex) : argv;
const jsonOutput = hasFlag('--json', globalArgs) || hasFlag('--json', commandArgs);
const nonInteractive = hasFlag('--non-interactive', globalArgs)
  || hasFlag('--non-interactive', commandArgs)
  || process.env.QUICKSTACK_NONINTERACTIVE === '1'
  || process.env.QUICKDEPLOY_NONINTERACTIVE === '1'
  || process.env.CI === 'true';

function hasFlag(flag, args = commandArgs) {
  return args.includes(flag);
}

function optionValue(name, args = commandArgs) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionalArgs(args = commandArgs) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!['--json', '--yes', '--non-interactive', '--no-deploy', '--dry-run'].includes(arg)) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function emit(outcome, result = {}) {
  const body = {
    schemaVersion: 1,
    command: command || 'help',
    outcome,
    questions: [],
    warnings: [],
    errors: [],
    ...result,
  };
  if (jsonOutput) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  if (body.message) console.log(body.message);
  if (body.warnings?.length) body.warnings.forEach(warning => console.warn(`warning: ${warning}`));
  if (body.errors?.length) body.errors.forEach(error => console.error(error.message || error));
  if (body.questions?.length) {
    body.questions.forEach(question => {
      console.log(`${question.id}: ${question.message}`);
      if (question.options) question.options.forEach(option => console.log(`  - ${option.value}: ${option.label}`));
    });
  }
}

function die(message, code = 1, extra = {}) {
  emit('error', {
    ...extra,
    errors: [{ message }],
  });
  process.exit(code);
}

function helper(script, scriptArgs, { parseJson = false } = {}) {
  const result = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', script), ...scriptArgs], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `${script} failed`).trim();
    die(message, result.status || 1);
  }
  if (parseJson) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      die(`${script} did not return valid JSON.`);
    }
  }
  process.stdout.write(result.stdout);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function readQuickDeployState(root) {
  const index = await readJson(path.join(root, '.quickdeploy', 'index.json'));
  const appsDir = path.join(root, '.quickdeploy', 'apps');
  const apps = [];
  try {
    const entries = await fs.readdir(appsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const app = await readJson(path.join(appsDir, entry.name));
        if (app) apps.push(app);
      }
    }
  } catch {
    // no state yet
  }
  return { index, apps };
}

function selectStateForPath(state, root, cwd = process.cwd()) {
  const relCwd = path.relative(root, cwd) || '.';
  const appId = optionValue('--app');
  if (appId) return state.apps.find(app => app.appId === appId || app.id === appId);
  const matching = state.apps.filter(app => app.serviceRoot === relCwd || (relCwd !== '.' && relCwd.startsWith(`${app.serviceRoot}/`)));
  return matching.length === 1 ? matching[0] : undefined;
}

function api(commandName, args, { parseJson = true } = {}) {
  return helper('quickstack-api.mjs', [commandName, ...args], { parseJson });
}

function resolveRoot() {
  return path.resolve(positionalArgs()[0] || process.cwd());
}

function ensureCredentialsForApi() {
  if (!process.env.QUICKSTACK_URL) die('QUICKSTACK_URL is required for API-backed commands.');
  if (!process.env.QUICKSTACK_API_KEY) die('QUICKSTACK_API_KEY is required for API-backed commands.');
}

function buildAmbiguityQuestions(detection) {
  const questions = [];
  if (detection.deployableServices?.length > 1) {
    questions.push({
      id: 'service',
      message: 'Multiple deployable services were detected. Choose a service root or decide to deploy multiple apps.',
      options: detection.deployableServices.map(service => ({
        value: service.root,
        label: `${service.name} (${service.mode}${service.framework ? `, ${service.framework}` : ''})`,
      })).concat([{ value: 'multi', label: 'Deploy multiple QuickStack apps' }]),
    });
  }
  if (detection.composeFiles?.length) {
    questions.push({ id: 'compose', message: 'Compose import needs a supported-service plan before deployment.' });
  }
  if (detection.kubernetesFiles?.length) {
    questions.push({ id: 'kubernetes', message: 'Kubernetes import needs allowlist validation before deployment.' });
  }
  return questions;
}

async function commandDetect() {
  const root = resolveRoot();
  helper('detect.mjs', [root]);
}

async function commandPackage() {
  const args = positionalArgs();
  if (!args[0]) die('Usage: quickstack package <path> --out <context.tar>');
  helper('package.mjs', commandArgs);
}

async function commandApi() {
  if (commandArgs.length === 0) die('Usage: quickstack api <me|ensure|upload|deploy> ...');
  helper('quickstack-api.mjs', commandArgs);
}

async function commandLaunch() {
  const root = resolveRoot();
  const detection = helper('detect.mjs', [root], { parseJson: true });
  const questions = buildAmbiguityQuestions(detection);
  if (questions.length > 0 && !optionValue('--service-root') && !hasFlag('--yes')) {
    emit(nonInteractive ? 'error' : 'question', {
      message: nonInteractive ? 'QuickStack launch needs more information before deployment.' : 'QuickStack needs a deployment choice before launch.',
      questions,
      detection,
    });
    process.exit(nonInteractive ? 2 : 0);
  }

  const image = optionValue('--image');
  if (!image) {
    emit('error', {
      message: 'Managed source uploads need the QuickStack reservation/build/update/deploy API before launch can deploy this project.',
      errors: [{
        code: 'managed_upload_requires_reservation',
        message: 'Run with --image for existing-image deploys, or implement the managed reservation/build flow before source launch.',
      }],
      detection,
    });
    process.exit(2);
  }

  ensureCredentialsForApi();
  const me = api('me', []);
  const projectId = optionValue('--project') || me.projects?.[0]?.id;
  if (!projectId) die('No QuickStack project is available. Pass --project <projectId>.');
  const name = optionValue('--name') || detection.deployableServices?.[0]?.name || path.basename(root);
  const port = Number(optionValue('--port') || detection.deployableServices?.[0]?.candidatePort || 80);
  const registryUsername = optionValue('--registry-username') || (hasFlag('--registry-from-env') ? process.env.QUICKSTACK_REGISTRY_USERNAME : undefined);
  const registryPassword = optionValue('--registry-password-file')
    ? await fs.readFile(path.resolve(optionValue('--registry-password-file')), 'utf8')
    : (hasFlag('--registry-from-env') ? process.env.QUICKSTACK_REGISTRY_PASSWORD : undefined);
  const ensurePayload = { projectId, name, image, port, mode: 'image', registryUsername, registryPassword };
  const ensured = api('ensure', [JSON.stringify(ensurePayload)]);

  if (!hasFlag('--no-deploy')) {
    api('deploy', [ensured.appId]);
  }

  const appState = {
    version: 1,
    name,
    projectId,
    appId: ensured.appId,
    serviceRoot: '.',
    mode: 'image',
    port,
    domain: { mode: 'generated', hostname: ensured.hostname, url: ensured.url },
    image: { managed: false, reference: image },
    updatedAt: new Date().toISOString(),
  };
  await writeJson(path.join(root, '.quickdeploy', 'index.json'), { version: 1, apps: [{ appId: ensured.appId, serviceRoot: '.', environment: optionValue('--env') || 'default' }] });
  await writeJson(path.join(root, '.quickdeploy', 'apps', `${ensured.appId}.json`), appState);

  emit('success', {
    message: hasFlag('--no-deploy') ? `QuickStack app configured: ${ensured.url}` : `QuickStack app deployed: ${ensured.url}`,
    app: appState,
  });
}

async function commandDeploy() {
  const root = resolveRoot();
  const state = await readQuickDeployState(root);
  const selected = selectStateForPath(state, root);
  if (!selected) {
    const message = state.apps.length > 1
      ? 'Multiple QuickStack apps are linked. Pass --app <appId> or run from a service directory.'
      : 'No .quickdeploy state found for this directory. Run quickstack launch first, or pass explicit app/project flags.';
    emit('error', { errors: [{ code: 'missing_or_ambiguous_state', message }], apps: state.apps });
    process.exit(2);
  }
  ensureCredentialsForApi();
  if (selected.mode !== 'image') {
    emit('error', {
      errors: [{ code: 'managed_upload_deploy_not_ready', message: 'Managed upload deploy requires the server build/update/deploy flow before this CLI can safely deploy source state.' }],
      app: selected,
    });
    process.exit(2);
  }
  const result = api('deploy', [selected.appId]);
  emit('success', { message: `Deployment requested for ${selected.name || selected.appId}.`, deployment: result, app: selected });
}

function parseDotenv(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.push({ key, value });
  }
  return entries;
}

function looksSecret(key) {
  return /(TOKEN|SECRET|PASSWORD|PASS|KEY|DATABASE_URL|REDIS_URL|PRIVATE|CREDENTIAL|AUTH|REGISTRY)/i.test(key);
}

async function commandSecrets() {
  const sub = commandArgs[0];
  if (sub === 'import') {
    const file = commandArgs[1] || '.env';
    const appId = optionValue('--app');
    const dryRun = hasFlag('--dry-run') || !appId;
    const rawEntries = parseDotenv(await fs.readFile(path.resolve(file), 'utf8').catch(() => die(`Could not read ${file}.`)));
    const plan = rawEntries.map(entry => ({ key: entry.key, classification: looksSecret(entry.key) ? 'secret' : 'public' }));
    if (dryRun) {
      emit('success', {
        message: 'Secret import plan generated. Pass --app to apply secret-classified keys.',
        plan,
      });
      return;
    }

    ensureCredentialsForApi();
    const secrets = Object.fromEntries(rawEntries.filter(entry => looksSecret(entry.key)).map(entry => [entry.key, entry.value]));
    const publicEnv = rawEntries.filter(entry => !looksSecret(entry.key)).map(entry => entry.key);
    const result = api('secrets-set', [appId, JSON.stringify({ secrets })]);
    emit('success', {
      message: `Imported ${Object.keys(secrets).length} secret(s) for app ${appId}. Public env keys were not changed by this command.`,
      appId,
      secretNames: Object.keys(secrets).sort(),
      publicEnvKeys: publicEnv.sort(),
      result: { status: result.status, appId: result.appId, projectId: result.projectId, secrets: result.secrets },
    });
    return;
  }
  if (sub === 'set') {
    const inlineValues = commandArgs.slice(1).filter(value => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value));
    if (inlineValues.length > 0) {
      die('Inline KEY=value secrets are refused because they leak to shell history and process listings. Use --from-file, --from-env, or stdin.');
    }
    const appId = optionValue('--app');
    const fromEnv = optionValue('--from-env');
    const fromFile = optionValue('--from-file');
    if (!appId) die('Usage: quickstack secrets set --app <appId> (--from-env KEY|--from-file KEY=path)');
    let name;
    let value;
    if (fromEnv) {
      name = fromEnv;
      value = process.env[fromEnv];
      if (value === undefined) die(`Environment variable ${fromEnv} is not set.`);
    } else if (fromFile) {
      const equals = fromFile.indexOf('=');
      if (equals <= 0) die('Use --from-file KEY=path.');
      name = fromFile.slice(0, equals);
      value = await fs.readFile(path.resolve(fromFile.slice(equals + 1)), 'utf8');
    } else {
      const rl = readline.createInterface({ input, output });
      name = await rl.question('Secret name: ');
      value = await rl.question('Secret value (input is visible in this preview CLI): ');
      rl.close();
    }
    ensureCredentialsForApi();
    const result = api('secrets-set', [appId, JSON.stringify({ secrets: { [name]: value } })]);
    emit('success', { message: `Set secret ${name} for app ${appId}.`, appId, secretNames: [name], result: { status: result.status, secrets: result.secrets } });
    return;
  }
  if (sub === 'list') {
    const appId = optionValue('--app') || commandArgs.slice(1).find(value => !value.startsWith('-'));
    if (!appId) die('Usage: quickstack secrets list --app <appId>');
    ensureCredentialsForApi();
    const result = api('secrets-list', [appId]);
    emit('success', { message: `Listed ${result.secrets?.length ?? 0} secret(s). Values are never returned.`, appId, secrets: result.secrets });
    return;
  }
  if (sub === 'unset') {
    const appId = optionValue('--app');
    const names = positionalArgs(commandArgs.slice(1)).filter(value => value !== appId);
    if (!appId || names.length === 0) die('Usage: quickstack secrets unset --app <appId> KEY [KEY...]');
    ensureCredentialsForApi();
    const result = api('secrets-set', [appId, JSON.stringify({ unset: names })]);
    emit('success', { message: `Unset ${names.length} secret(s) for app ${appId}.`, appId, secretNames: names.sort(), result: { status: result.status, secrets: result.secrets } });
    return;
  }
  die('Usage: quickstack secrets <import|set|list|unset> ...');
}

async function commandPostgres() {
  const sub = commandArgs[0];
  if (sub === 'create') {
    const projectId = optionValue('--project');
    if (!projectId) die('Usage: quickstack postgres create --project <projectId> [--attach <appId>] [--name <name>]');
    ensureCredentialsForApi();
    const payload = {
      projectId,
      name: optionValue('--name'),
      databaseName: optionValue('--database'),
      username: optionValue('--username'),
      attachAppId: optionValue('--attach'),
      secretName: optionValue('--secret-name') || 'DATABASE_URL',
    };
    const result = api('postgres', [JSON.stringify(payload)]);
    emit('success', {
      message: result.attached
        ? `Created Postgres ${result.databaseAppId} and attached it as ${result.attached.secretName}.`
        : `Created Postgres ${result.databaseAppId}.`,
      result,
    });
    return;
  }
  if (sub === 'attach') {
    const databaseAppId = commandArgs[1] || optionValue('--database-app');
    const appId = optionValue('--app');
    if (!databaseAppId || !appId) die('Usage: quickstack postgres attach <databaseAppId> --app <appId> [--secret-name DATABASE_URL]');
    ensureCredentialsForApi();
    const result = api('postgres', [JSON.stringify({ mode: 'attach', databaseAppId, appId, secretName: optionValue('--secret-name') || 'DATABASE_URL' })]);
    emit('success', { message: `Attached Postgres ${databaseAppId} to ${appId} as ${result.secretName}.`, result });
    return;
  }
  die('Usage: quickstack postgres <create|attach> ...');
}

async function commandConfig() {
  const sub = commandArgs[0] || 'show';
  const rootArg = commandArgs.slice(1).find(arg => !arg.startsWith('-'));
  const root = path.resolve(rootArg || process.cwd());
  const state = await readQuickDeployState(root);
  if (sub === 'show') {
    emit('success', { state });
    return;
  }
  if (sub === 'validate') {
    const secretLeak = JSON.stringify(state).match(/qstk_|password|secret|token/i);
    if (secretLeak) die('Local .quickdeploy state appears to contain secret-like material. Remove it before committing.', 2, { state });
    emit('success', { message: state.index || state.apps.length > 0 ? '.quickdeploy state contains no obvious secret markers.' : 'No .quickdeploy state found; nothing to validate.', state });
    return;
  }
  if (sub === 'pull' || sub === 'repair') {
    die(`quickstack config ${sub} needs a server state endpoint before it can run safely.`);
  }
  die('Usage: quickstack config <show|validate|pull|repair>');
}

async function commandRemoteRead(name) {
  const root = resolveRoot();
  const state = await readQuickDeployState(root);
  const selected = selectStateForPath(state, root) || (optionValue('--app') ? { appId: optionValue('--app') } : undefined);
  if (!selected?.appId) die(`Usage: quickstack ${name} [path] --app <appId>`);
  ensureCredentialsForApi();
  const result = api(name, [selected.appId]);
  emit('success', {
    message: `Fetched ${name} for ${selected.name || selected.appId}.`,
    appId: selected.appId,
    result,
  });
}

async function commandNotImplemented(name) {
  emit('not_implemented', {
    message: `quickstack ${name} is reserved for the first-class CLI surface but is not implemented in this build yet.`,
    errors: [{ code: 'not_implemented', message: `quickstack ${name} is not implemented yet.` }],
  });
  process.exit(2);
}

function help() {
  console.log(`QuickStack CLI preview

Usage:
  quickstack launch [path] [--image <image>] [--project <id>] [--name <name>] [--port <port>] [--registry-from-env] [--no-deploy] [--json]
  quickstack deploy [path] [--app <id>] [--json]
  quickstack detect [path]
  quickstack package <path> --out <context.tar>
  quickstack secrets import <.env> [--dry-run] [--json]
  quickstack status|logs|releases [path] [--app <id>] [--json]
  quickstack postgres create --project <id> [--attach <appId>]
  quickstack postgres attach <databaseAppId> --app <appId>
  quickstack config <show|validate>
  quickstack api <me|ensure|upload|deploy|status|logs|releases|secrets-list|secrets-set|postgres> ...

Reserved first-class verbs:
  rollback, checks, restart, scale, domains,
  tokens, redis, volumes, registry, proxy, shell, unlink, destroy

Environment:
  QUICKSTACK_URL       QuickStack dashboard URL
  QUICKSTACK_API_KEY   qstk_ API key from the dashboard

Notes:
  The CLI is the primary QuickStack deploy surface. The Claude skill should invoke
  this CLI and relay its JSON questions/errors instead of reimplementing deploys.
`);
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }

  if (command === 'detect') return commandDetect();
  if (command === 'package') return commandPackage();
  if (command === 'api') return commandApi();
  if (command === 'launch') return commandLaunch();
  if (command === 'deploy') return commandDeploy();
  if (command === 'secrets') return commandSecrets();
  if (command === 'config') return commandConfig();
  if (command === 'postgres') return commandPostgres();
  if (['status', 'logs', 'releases'].includes(command)) return commandRemoteRead(command);

  if (['rollback', 'checks', 'restart', 'scale', 'domains', 'tokens', 'redis', 'volumes', 'registry', 'proxy', 'shell', 'unlink', 'destroy'].includes(command)) {
    return commandNotImplemented(command);
  }

  die(`Unknown command: ${command}`);
}

main().catch(error => die(error instanceof Error ? error.message : String(error)));
