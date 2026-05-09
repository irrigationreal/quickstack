#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readQuickStackConfig } from '../scripts/config.mjs';

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

async function ensureCredentialsForApi() {
  const config = await readQuickStackConfig();
  if (!process.env.QUICKSTACK_URL && typeof config.url === 'string') process.env.QUICKSTACK_URL = config.url;
  if (!process.env.QUICKSTACK_API_KEY && typeof config.apiKey === 'string') process.env.QUICKSTACK_API_KEY = config.apiKey;
  if (!process.env.QUICKSTACK_URL) die('QUICKSTACK_URL is required for API-backed commands. Run quickstack setup, set QUICKSTACK_URL, or create ~/.quickstack/config.json.');
  if (!process.env.QUICKSTACK_API_KEY) die('QUICKSTACK_API_KEY is required for API-backed commands. Run quickstack setup, set QUICKSTACK_API_KEY, or create ~/.quickstack/config.json.');
}

function parseEndpointSpecs() {
  const specs = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    if (commandArgs[index] !== '--endpoint') continue;
    const value = commandArgs[index + 1];
    if (!value) die('--endpoint requires <publicIp:publicPort:targetPort[/protocol]>.');
    const [addressAndPorts, protocol = 'TCP'] = value.split('/');
    const parts = addressAndPorts.split(':');
    if (parts.length !== 3) die('--endpoint must be formatted as <publicIp:publicPort:targetPort[/protocol]>.');
    const publicPort = Number(parts[1]);
    const targetPort = Number(parts[2]);
    if (!Number.isInteger(publicPort) || !Number.isInteger(targetPort)) die('--endpoint public and target ports must be integers.');
    specs.push({
      publicIp: parts[0],
      publicPort,
      targetPort,
      protocol: protocol.toUpperCase(),
      sourceCidrsText: optionValue('--endpoint-source-cidrs') || '',
    });
  }
  return specs;
}

function buildAmbiguityQuestions(detection, { includeDomainQuestion = false, includeRawEndpointQuestion = false } = {}) {
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
  if (includeRawEndpointQuestion && detection.rawPublicEndpointCandidates?.length) {
    questions.push({
      id: 'public-endpoints',
      message: 'Non-web exposed ports were detected. QuickStack will not expose raw TCP ports automatically; pass explicit --endpoint <publicIp:publicPort:targetPort[/protocol]> flags for each reservation to create.',
      options: detection.rawPublicEndpointCandidates.map(endpoint => ({
        value: `${endpoint.publicPort}:${endpoint.targetPort}/${endpoint.protocol}`,
        label: `${endpoint.source}${endpoint.serviceName ? ` ${endpoint.serviceName}` : ''}: ${endpoint.publicPort}->${endpoint.targetPort}/${endpoint.protocol}`,
      })),
    });
  }
  if (includeDomainQuestion) {
    questions.push({
      id: 'domain',
      message: 'Choose the public domain for this new app.',
      options: [
        { value: 'auto', label: 'Generate a QuickStack hostname automatically' },
        { value: 'custom', label: 'Use a custom hostname with DNS already pointed at QuickStack' },
      ],
    });
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

function runChecked(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    die(`${commandName} ${args.join(' ')} failed.`, result.status || 1);
  }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  const stat = await fs.stat(file);
  return {
    contentHash: `sha256:${hash.digest('hex')}`,
    uploadBytes: stat.size,
  };
}

function serviceForLaunch(detection) {
  const serviceRoot = optionValue('--service-root');
  if (serviceRoot) {
    const service = detection.deployableServices?.find(item => item.root === serviceRoot);
    if (!service) die(`No deployable service was detected at --service-root ${serviceRoot}.`);
    return service;
  }
  return detection.deployableServices?.[0];
}

async function packageManagedSource(root, service) {
  const servicePath = path.join(root, service?.root || '.');
  const mode = service?.mode === 'dockerfile' ? 'dockerfile' : service?.mode === 'static-candidate' ? 'static' : undefined;
  if (!mode) {
    die('QuickStack managed launch currently supports Dockerfile projects and static frontend build outputs. Pass --image for other app servers.', 2, { service });
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quickstack-launch-'));
  const tarPath = path.join(tmpRoot, 'source.tar');
  try {
    const excludes = ['.git', '.quickdeploy', 'node_modules', '.next', 'dist', 'build', 'coverage']
      .flatMap(name => ['--exclude', name]);
    runChecked('tar', ['-C', servicePath, ...excludes, '-cf', tarPath, '.']);
    return { mode, tarPath, artifactType: 'source-tar', ...(await sha256File(tarPath)) };
  } catch (error) {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function reserveEndpointSpecs(appId, endpointSpecs) {
  const reserved = [];
  for (const endpoint of endpointSpecs) {
    const result = api('endpoints-reserve', [appId, JSON.stringify({
      name: endpoint.name,
      publicIp: endpoint.publicIp,
      publicPort: endpoint.publicPort,
      targetPort: endpoint.targetPort,
      protocol: endpoint.protocol || 'TCP',
      sourceCidrsText: endpoint.sourceCidrsText || '',
      enabled: true,
    })]);
    reserved.push(result.endpoint);
  }
  return reserved;
}

async function commandLaunch() {
  const root = resolveRoot();
  const detection = helper('detect.mjs', [root], { parseJson: true });
  const endpointSpecs = parseEndpointSpecs();
  const state = await readQuickDeployState(root);
  const existingState = selectStateForPath(state, root);
  const wantsGeneratedDomain = hasFlag('--yes') || optionValue('--domain-mode') === 'auto';
  const customHostname = optionValue('--domain') || optionValue('--hostname');
  const includeDomainQuestion = !existingState && !customHostname && !wantsGeneratedDomain;
  const includeRawEndpointQuestion = detection.rawPublicEndpointCandidates?.length > 0 && endpointSpecs.length === 0;
  const questions = buildAmbiguityQuestions(detection, { includeDomainQuestion, includeRawEndpointQuestion });
  const shouldStopForQuestions = questions.length > 0 && ((!optionValue('--service-root') && !hasFlag('--yes')) || includeRawEndpointQuestion);
  if (shouldStopForQuestions) {
    emit(nonInteractive ? 'error' : 'question', {
      message: nonInteractive ? 'QuickStack launch needs more information before deployment.' : 'QuickStack needs a deployment choice before launch.',
      questions,
      detection,
    });
    process.exit(nonInteractive ? 2 : 0);
  }

  const image = optionValue('--image');
  const service = serviceForLaunch(detection);

  await ensureCredentialsForApi();
  const me = api('me', []);
  const projectId = optionValue('--project') || me.projects?.[0]?.id;
  if (!projectId) die('No QuickStack project is available. Pass --project <projectId>.');
  const name = optionValue('--name') || service?.name || path.basename(root);
  const managedBuild = image ? undefined : await packageManagedSource(root, service);
  try {
    const port = Number(optionValue('--port') || service?.candidatePort || 80);
    const registryUsername = optionValue('--registry-username') || (hasFlag('--registry-from-env') ? process.env.QUICKSTACK_REGISTRY_USERNAME : undefined);
    const registryPassword = optionValue('--registry-password-file')
      ? await fs.readFile(path.resolve(optionValue('--registry-password-file')), 'utf8')
      : (hasFlag('--registry-from-env') ? process.env.QUICKSTACK_REGISTRY_PASSWORD : undefined);
    const appId = optionValue('--app');
    const ensurePayload = { projectId, appId, name, image: image || 'registry.invalid/quickstack-managed-pending:latest', port, mode: image ? 'image' : managedBuild.mode, registryUsername, registryPassword, customHostname };
    const ensured = api('ensure', [JSON.stringify(ensurePayload)]);

    let uploadedBuild;
    if (managedBuild) {
      uploadedBuild = api('upload', [ensured.appId, managedBuild.tarPath, JSON.stringify({
        projectId,
        mode: managedBuild.mode,
        artifactType: managedBuild.artifactType,
        contentHash: managedBuild.contentHash,
        uploadBytes: managedBuild.uploadBytes,
        dockerfilePath: service?.dockerfile || './Dockerfile',
      })]);
    }

    if (!hasFlag('--no-deploy')) {
      api('deploy', [ensured.appId]);
    }
    const reservedEndpoints = await reserveEndpointSpecs(ensured.appId, endpointSpecs);

    const appState = {
      version: 1,
      name,
      projectId,
      appId: ensured.appId,
      serviceRoot: service?.root || '.',
      mode: image ? 'image' : managedBuild.mode,
      port,
      domain: { mode: customHostname ? 'custom' : 'generated', hostname: ensured.hostname, url: ensured.url },
      image: image ? { managed: false, reference: image } : { managed: true, reference: uploadedBuild.imageReference, buildId: uploadedBuild.buildId, contentHash: managedBuild.contentHash, artifactType: managedBuild.artifactType },
      publicEndpoints: reservedEndpoints.map(endpoint => ({ id: endpoint.id, publicIp: endpoint.publicIp, publicPort: endpoint.publicPort, targetPort: endpoint.targetPort, protocol: endpoint.protocol, status: endpoint.status })),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(root, '.quickdeploy', 'index.json'), { version: 1, apps: [{ appId: ensured.appId, serviceRoot: service?.root || '.', environment: optionValue('--env') || 'default' }] });
    await writeJson(path.join(root, '.quickdeploy', 'apps', `${ensured.appId}.json`), appState);

    emit('success', {
      message: hasFlag('--no-deploy') ? `QuickStack app configured: ${ensured.url}` : `QuickStack app deployed: ${ensured.url}`,
      app: appState,
    });
  } finally {
    if (managedBuild) await fs.rm(path.dirname(managedBuild.tarPath), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function commandDeploy() {
  const root = resolveRoot();
  const state = await readQuickDeployState(root);
  const endpointSpecs = parseEndpointSpecs();
  const selected = selectStateForPath(state, root, root);
  if (!selected) {
    const message = state.apps.length > 1
      ? 'Multiple QuickStack apps are linked. Pass --app <appId> or run from a service directory.'
      : 'No .quickdeploy state found for this directory. Run quickstack launch first, or pass explicit app/project flags.';
    emit('error', { errors: [{ code: 'missing_or_ambiguous_state', message }], apps: state.apps });
    process.exit(2);
  }
  await ensureCredentialsForApi();
  let updatedApp = selected;
  if (selected.mode !== 'image') {
    const detection = helper('detect.mjs', [root], { parseJson: true });
    const service = detection.deployableServices?.find(item => item.root === selected.serviceRoot) || { root: selected.serviceRoot, mode: selected.mode };
    const managedBuild = await packageManagedSource(root, service);
    try {
      const upload = api('upload', [selected.appId, managedBuild.tarPath, JSON.stringify({
        projectId: selected.projectId,
        mode: managedBuild.mode,
        artifactType: managedBuild.artifactType,
        contentHash: managedBuild.contentHash,
        uploadBytes: managedBuild.uploadBytes,
        dockerfilePath: service?.dockerfile || './Dockerfile',
      })]);
      updatedApp = {
        ...selected,
        image: { managed: true, reference: upload.imageReference, buildId: upload.buildId, contentHash: managedBuild.contentHash, artifactType: managedBuild.artifactType },
        updatedAt: new Date().toISOString(),
      };
      await writeJson(path.join(root, '.quickdeploy', 'apps', `${selected.appId}.json`), updatedApp);
    } finally {
      await fs.rm(path.dirname(managedBuild.tarPath), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  const result = api('deploy', [selected.appId]);
  const reservedEndpoints = await reserveEndpointSpecs(selected.appId, endpointSpecs);
  if (reservedEndpoints.length > 0) {
    updatedApp = {
      ...updatedApp,
      publicEndpoints: reservedEndpoints.map(endpoint => ({ id: endpoint.id, publicIp: endpoint.publicIp, publicPort: endpoint.publicPort, targetPort: endpoint.targetPort, protocol: endpoint.protocol, status: endpoint.status })),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(root, '.quickdeploy', 'apps', `${selected.appId}.json`), updatedApp);
  }
  emit('success', { message: `Deployment requested for ${selected.name || selected.appId}.`, deployment: result, app: updatedApp, publicEndpoints: reservedEndpoints });
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

function requireSelectedApp(root, state, commandName) {
  const selected = selectStateForPath(state, root, root) || (optionValue('--app') ? { appId: optionValue('--app') } : undefined);
  if (!selected?.appId) die(`Usage: quickstack ${commandName} [path] --app <appId>`);
  return selected;
}

function requiredNumberOption(name) {
  const value = optionValue(name);
  const parsed = value ? Number(value) : NaN;
  if (!Number.isInteger(parsed)) die(`${name} must be an integer.`);
  return parsed;
}

async function commandEndpoints() {
  const sub = commandArgs[0];
  const root = resolveRoot();
  const state = await readQuickDeployState(root);
  const selected = requireSelectedApp(root, state, `endpoints ${sub || ''}`.trim());
  await ensureCredentialsForApi();

  if (sub === 'list') {
    const result = api('endpoints-list', [selected.appId]);
    emit('success', {
      message: `Fetched public endpoint reservations for ${selected.name || selected.appId}.`,
      appId: selected.appId,
      endpoints: result.endpoints || [],
    });
    return;
  }

  if (sub === 'reserve') {
    const publicIp = optionValue('--public-ip') || optionValue('--ip');
    if (!publicIp) die('quickstack endpoints reserve requires --public-ip <ip>.');
    const publicPort = requiredNumberOption('--public-port');
    const targetPort = requiredNumberOption('--target-port');
    const payload = {
      id: optionValue('--id') || undefined,
      name: optionValue('--name') || undefined,
      publicIp,
      publicPort,
      targetPort,
      protocol: (optionValue('--protocol') || 'TCP').toUpperCase(),
      sourceCidrsText: optionValue('--source-cidrs') || '',
      proxyProtocol: hasFlag('--proxy-protocol'),
      enabled: !hasFlag('--disabled'),
    };
    const result = api('endpoints-reserve', [selected.appId, JSON.stringify(payload)]);
    emit('success', {
      message: `Reserved ${result.endpoint.publicIp}:${result.endpoint.publicPort}/${result.endpoint.protocol} for ${selected.name || selected.appId}.`,
      appId: selected.appId,
      endpoint: result.endpoint,
    });
    return;
  }

  if (sub === 'release') {
    const payload = optionValue('--id')
      ? { id: optionValue('--id') }
      : {
        publicIp: optionValue('--public-ip') || optionValue('--ip'),
        publicPort: requiredNumberOption('--public-port'),
        protocol: (optionValue('--protocol') || 'TCP').toUpperCase(),
      };
    const result = api('endpoints-release', [selected.appId, JSON.stringify(payload)]);
    emit('success', {
      message: `Released ${result.released.publicIp}:${result.released.publicPort}/${result.released.protocol} from ${selected.name || selected.appId}.`,
      appId: selected.appId,
      released: result.released,
    });
    return;
  }

  die('Usage: quickstack endpoints <list|reserve|release> [path] --app <appId> [--public-ip <ip> --public-port <port> --target-port <port>]');
}

async function commandVolumes() {
  const sub = commandArgs[0];
  const rootArg = commandArgs[1] && !commandArgs[1].startsWith('--') ? commandArgs[1] : undefined;
  const root = rootArg ? path.resolve(rootArg) : resolveRoot();
  const state = await readQuickDeployState(root);
  const selected = requireSelectedApp(root, state, `volumes ${sub || ''}`.trim());
  await ensureCredentialsForApi();

  if (sub === 'list') {
    const result = api('volumes-list', [selected.appId]);
    emit('success', {
      message: `Fetched volumes for ${selected.name || selected.appId}.`,
      appId: selected.appId,
      volumes: result.volumes || [],
    });
    return;
  }

  if (sub === 'add') {
    const containerMountPath = optionValue('--mount-path') || optionValue('--path');
    if (!containerMountPath) die('quickstack volumes add requires --mount-path <container-path>.');
    const payload = {
      id: optionValue('--id') || undefined,
      containerMountPath,
      size: requiredNumberOption('--size'),
      accessMode: optionValue('--access-mode') || 'ReadWriteOnce',
      storageClassName: optionValue('--storage-class') || 'longhorn',
      shareWithOtherApps: hasFlag('--share'),
    };
    const result = api('volumes-add', [selected.appId, JSON.stringify(payload)]);
    emit('success', {
      message: `Attached volume ${result.volume.containerMountPath} to ${selected.name || selected.appId}. Redeploy the app for the mount to become active.`,
      appId: selected.appId,
      volume: result.volume,
    });
    return;
  }

  if (sub === 'remove' || sub === 'rm') {
    const payload = optionValue('--id')
      ? { id: optionValue('--id') }
      : { containerMountPath: optionValue('--mount-path') || optionValue('--path') };
    if (!payload.id && !payload.containerMountPath) die('quickstack volumes remove requires --id <volumeId> or --mount-path <container-path>.');
    const result = api('volumes-remove', [selected.appId, JSON.stringify(payload)]);
    emit('success', {
      message: `Detached volume ${result.removed.containerMountPath} from ${selected.name || selected.appId}. Redeploy the app for the mount to be removed and stale PVC cleanup to run.`,
      appId: selected.appId,
      removed: result.removed,
    });
    return;
  }

  die('Usage: quickstack volumes <list|add|remove> [path] --app <appId> [--mount-path <path> --size <MiB>]');
}

async function commandExec() {
  const separator = commandArgs.indexOf('--');
  if (separator < 0 || separator === commandArgs.length - 1) die('Usage: quickstack exec [appId|path] -- <command> [args...]');
  const execCommand = commandArgs.slice(separator + 1);
  const selectionArgs = commandArgs.slice(0, separator);
  const explicitAppId = optionValue('--app', selectionArgs);
  let selected;
  if (explicitAppId) {
    selected = { appId: explicitAppId };
  } else if (selectionArgs[0]) {
    const possibleRoot = path.resolve(selectionArgs[0]);
    const isDirectory = await fs.stat(possibleRoot).then(stat => stat.isDirectory()).catch(() => false);
    if (isDirectory) {
      const state = await readQuickDeployState(possibleRoot);
      selected = selectStateForPath(state, possibleRoot) || undefined;
    } else {
      selected = { appId: selectionArgs[0] };
    }
  } else {
    const root = resolveRoot();
    const state = await readQuickDeployState(root);
    selected = selectStateForPath(state, root) || undefined;
  }
  if (!selected?.appId) die('Usage: quickstack exec [appId|path] -- <command> [args...]');
  await ensureCredentialsForApi();
  const result = api('exec', [selected.appId, JSON.stringify({ command: execCommand, tty: hasFlag('--tty', selectionArgs) })]);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (jsonOutput) {
    emit(result.exitCode === 0 ? 'success' : 'error', {
      appId: selected.appId,
      podName: result.podName,
      containerName: result.containerName,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  process.exit(result.exitCode || 0);
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

    await ensureCredentialsForApi();
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
    const inlineValues = positionalArgs(commandArgs.slice(1)).filter(value => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value));
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
    await ensureCredentialsForApi();
    const result = api('secrets-set', [appId, JSON.stringify({ secrets: { [name]: value } })]);
    emit('success', { message: `Set secret ${name} for app ${appId}.`, appId, secretNames: [name], result: { status: result.status, secrets: result.secrets } });
    return;
  }
  if (sub === 'list') {
    const appId = optionValue('--app') || commandArgs.slice(1).find(value => !value.startsWith('-'));
    if (!appId) die('Usage: quickstack secrets list --app <appId>');
    await ensureCredentialsForApi();
    const result = api('secrets-list', [appId]);
    emit('success', { message: `Listed ${result.secrets?.length ?? 0} secret(s). Values are never returned.`, appId, secrets: result.secrets });
    return;
  }
  if (sub === 'unset') {
    const appId = optionValue('--app');
    const names = positionalArgs(commandArgs.slice(1)).filter(value => value !== appId);
    if (!appId || names.length === 0) die('Usage: quickstack secrets unset --app <appId> KEY [KEY...]');
    await ensureCredentialsForApi();
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
    await ensureCredentialsForApi();
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
        ? `Created Postgres ${result.databaseAppId}, deployed it, and attached it as ${result.attached.secretName}.`
        : `Created and deployed Postgres ${result.databaseAppId}.`,
      result,
    });
    return;
  }
  if (sub === 'list') {
    const projectId = optionValue('--project');
    if (!projectId) die('Usage: quickstack postgres list --project <projectId>');
    await ensureCredentialsForApi();
    const result = api('postgres-list', [projectId]);
    emit('success', { message: `Fetched ${result.databases?.length || 0} managed Postgres database(s).`, result });
    return;
  }
  if (sub === 'attach') {
    const databaseAppId = commandArgs[1] || optionValue('--database-app');
    const appId = optionValue('--app');
    if (!databaseAppId || !appId) die('Usage: quickstack postgres attach <databaseAppId> --app <appId> [--secret-name DATABASE_URL]');
    await ensureCredentialsForApi();
    const result = api('postgres', [JSON.stringify({ mode: 'attach', databaseAppId, appId, secretName: optionValue('--secret-name') || 'DATABASE_URL' })]);
    emit('success', { message: `Attached Postgres ${databaseAppId} to ${appId} as ${result.secretName}.`, result });
    return;
  }
  if (sub === 'destroy') {
    const databaseAppId = commandArgs[1] || optionValue('--database-app');
    if (!databaseAppId) die('Usage: quickstack postgres destroy <databaseAppId>');
    await ensureCredentialsForApi();
    const result = api('postgres-destroy', [JSON.stringify({ databaseAppId })]);
    emit('success', { message: `Destroyed managed Postgres ${databaseAppId}.`, result });
    return;
  }
  die('Usage: quickstack postgres <create|list|attach|destroy> ...');
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

async function selectedRemoteApp(name) {
  const explicitAppId = optionValue('--app');
  if (explicitAppId) return { appId: explicitAppId };

  const [firstPositional] = positionalArgs();
  if (firstPositional) {
    const possibleRoot = path.resolve(firstPositional);
    const isDirectory = await fs.stat(possibleRoot).then(stat => stat.isDirectory()).catch(() => false);
    if (!isDirectory) return { appId: firstPositional };
    const state = await readQuickDeployState(possibleRoot);
    return selectStateForPath(state, possibleRoot) || undefined;
  }

  const root = resolveRoot();
  const state = await readQuickDeployState(root);
  return selectStateForPath(state, root) || undefined;
}

function queryString(params) {
  return new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')).toString();
}

async function commandRemoteRead(name) {
  const selected = await selectedRemoteApp(name);
  if (!selected?.appId) die(`Usage: quickstack ${name} [appId|path] --app <appId>`);
  await ensureCredentialsForApi();
  if (name === 'logs') return commandLogs(selected);
  const result = api(name, [selected.appId]);
  emit('success', {
    message: `Fetched ${name} for ${selected.name || selected.appId}.`,
    appId: selected.appId,
    result,
  });
}

async function commandScale() {
  const selected = await selectedRemoteApp('scale');
  if (!selected?.appId) die('Usage: quickstack scale [appId|path] --replicas <count>');
  const replicas = Number(optionValue('--replicas') || commandArgs.find((arg, index) => commandArgs[index - 1] !== '--replicas' && /^\d+$/.test(arg)));
  if (!Number.isInteger(replicas) || replicas < 0) die('quickstack scale requires --replicas <non-negative integer>.');
  await ensureCredentialsForApi();
  const result = api('scale', [selected.appId, String(replicas)]);
  emit('success', {
    message: `Scaled ${selected.name || selected.appId} to ${replicas} replica(s).`,
    appId: selected.appId,
    replicas,
    result,
  });
}

async function commandRollback() {
  const selected = await selectedRemoteApp('rollback');
  if (!selected?.appId) die('Usage: quickstack rollback [appId|path] --app <appId>');
  await ensureCredentialsForApi();
  const result = api('rollback', [selected.appId]);
  emit('success', {
    message: `Rolled back ${selected.name || selected.appId}.`,
    appId: selected.appId,
    result,
  });
}

async function commandLogs(selected) {
  const tail = optionValue('--tail') || '200';
  const source = hasFlag('--deployment') ? 'deployment' : 'container';
  const fetchLogs = () => api('logs', [selected.appId, queryString({ tail, source })]);
  if (!hasFlag('--follow')) {
    const result = fetchLogs();
    emit('success', {
      message: `Fetched logs for ${selected.name || selected.appId}.`,
      appId: selected.appId,
      result,
    });
    return;
  }

  let running = true;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });
  let previous = '';
  while (running) {
    const result = fetchLogs();
    const logs = result.logs || '';
    const delta = logs.startsWith(previous) ? logs.slice(previous.length) : logs;
    if (delta) process.stdout.write(delta.endsWith('\n') ? delta : `${delta}\n`);
    previous = logs;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function commandSetup() {
  const url = optionValue('--url') || process.env.QUICKSTACK_URL;
  const apiKey = optionValue('--api-key') || process.env.QUICKSTACK_API_KEY;
  if (!url || !apiKey) {
    die('Usage: quickstack setup --url <quickstack-url> --api-key <qstk_key>. Do not run this from inside a project if it would write secrets to the repo; credentials are stored in ~/.quickstack/config.json.');
  }
  if (!/^qstk_/.test(apiKey)) {
    die('The API key should start with qstk_.');
  }
  const configPath = process.env.QUICKSTACK_CONFIG || path.join(os.homedir(), '.quickstack', 'config.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify({ url: url.replace(/\/$/, ''), apiKey }, null, 2)}\n`, { mode: 0o600 });
  try { await fs.chmod(configPath, 0o600); } catch {}
  emit('success', {
    message: `QuickStack credentials saved to ${configPath}.`,
    configPath,
    url: url.replace(/\/$/, ''),
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
  quickstack setup --url <quickstack-url> --api-key <qstk_key>
  quickstack launch [path] [--image <image>] [--project <id>] [--name <name>] [--port <port>] [--domain <hostname>|--domain-mode auto] [--endpoint <publicIp:publicPort:targetPort[/protocol]>] [--registry-from-env] [--no-deploy] [--json]
  quickstack deploy [path] [--app <id>] [--endpoint <publicIp:publicPort:targetPort[/protocol]>] [--json]
  quickstack detect [path]
  quickstack package <path> --out <context.tar>
  quickstack secrets import <.env> [--dry-run] [--json]
  quickstack endpoints list [path] [--app <id>] [--json]
  quickstack endpoints reserve [path] --app <id> [--id <endpointId>] --public-ip <ip> --public-port <port> --target-port <port> [--protocol TCP] [--source-cidrs <cidrs>] [--json]
  quickstack endpoints release [path] --app <id> (--id <endpointId>|--public-ip <ip> --public-port <port> [--protocol TCP]) [--json]
  quickstack status|releases [appId|path] [--app <id>] [--json]
  quickstack logs [appId|path] [--app <id>] [--tail <lines>] [--follow] [--deployment] [--json]
  quickstack scale [appId|path] --replicas <count> [--json]
  quickstack rollback [appId|path] [--json]
  quickstack postgres create --project <id> [--attach <appId>]
  quickstack postgres list --project <id>
  quickstack postgres attach <databaseAppId> --app <appId>
  quickstack postgres destroy <databaseAppId>
  quickstack config <show|validate>
  quickstack api <me|ensure|upload|deploy|scale|rollback|status|logs|releases|secrets-list|secrets-set|postgres|postgres-list|postgres-destroy> ...

Reserved first-class verbs:
  rollback, checks, restart, scale, domains,
  tokens, redis, volumes, registry, proxy, shell, unlink, destroy

Credentials:
  quickstack setup stores the dashboard URL and qstk_ API key in ~/.quickstack/config.json with 0600 permissions.
  QUICKSTACK_URL and QUICKSTACK_API_KEY still work as environment overrides for CI.

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

  if (command === 'setup') return commandSetup();
  if (command === 'detect') return commandDetect();
  if (command === 'package') return commandPackage();
  if (command === 'api') return commandApi();
  if (command === 'launch') return commandLaunch();
  if (command === 'deploy') return commandDeploy();
  if (command === 'secrets') return commandSecrets();
  if (command === 'config') return commandConfig();
  if (command === 'postgres') return commandPostgres();
  if (command === 'endpoints') return commandEndpoints();
  if (command === 'volumes') return commandVolumes();
  if (command === 'exec' || command === 'ssh') return commandExec();
  if (command === 'scale') return commandScale();
  if (command === 'rollback') return commandRollback();
  if (['status', 'logs', 'releases'].includes(command)) return commandRemoteRead(command);

  if (['checks', 'restart', 'domains', 'tokens', 'redis', 'volumes', 'registry', 'proxy', 'shell', 'unlink', 'destroy'].includes(command)) {
    return commandNotImplemented(command);
  }

  die(`Unknown command: ${command}`);
}

main().catch(error => die(error instanceof Error ? error.message : String(error)));
