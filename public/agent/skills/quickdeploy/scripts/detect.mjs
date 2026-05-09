#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const MAX_DEPTH = 4;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.quickdeploy', '.turbo', '.cache', '.pnpm-store', '.venv', '__pycache__']);
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const K8S_DIRS = new Set(['k8s', 'kubernetes', 'deploy', '.k8s']);

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function walk(dir, depth = 0, acc = []) {
  if (depth > MAX_DEPTH) return acc;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full) || '.';
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, depth + 1, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

function packageManager(files) {
  if (files.includes('pnpm-lock.yaml') || files.includes('pnpm-workspace.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('package-lock.json')) return 'npm';
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun';
  return null;
}

function detectFramework(pkg, filesAtRoot) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps.next) return 'next';
  if (deps.vite || filesAtRoot.includes('vite.config.ts') || filesAtRoot.includes('vite.config.js')) return 'vite';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.vue || deps['@vue/cli-service']) return 'vue';
  if (deps.react) return 'react';
  if (deps.express || deps.fastify || deps.koa || deps.hono || deps.nestjs || deps['@nestjs/core']) return 'node-server';
  return null;
}

function projectNameFromPyproject(text) {
  return text.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
}

function candidatePort(pkg, dockerfileText) {
  const scripts = Object.values(pkg?.scripts || {}).join('\n');
  const text = `${scripts}\n${dockerfileText}`;
  const expose = dockerfileText.match(/EXPOSE\s+(\d+)/i)?.[1];
  if (expose) return Number(expose);
  const port = text.match(/PORT\s*=\s*(\d+)/)?.[1] || text.match(/--port\s+(\d+)/)?.[1] || text.match(/-p\s+(\d+)/)?.[1];
  return port ? Number(port) : undefined;
}

function isWebPort(port) {
  return [80, 443, 3000, 3001, 5000, 5173, 8000, 8080].includes(Number(port));
}

function addRawEndpointCandidate(candidates, candidate) {
  const protocol = (candidate.protocol || 'TCP').toUpperCase();
  if (protocol !== 'TCP') return;
  const targetPort = Number(candidate.targetPort || candidate.containerPort || candidate.publicPort);
  const publicPort = Number(candidate.publicPort || targetPort);
  if (!Number.isInteger(targetPort) || !Number.isInteger(publicPort) || isWebPort(targetPort)) return;
  const key = `${candidate.source}:${candidate.serviceName || ''}:${publicPort}:${targetPort}:${protocol}`;
  if (candidates.some(item => item.key === key)) return;
  candidates.push({
    key,
    source: candidate.source,
    serviceName: candidate.serviceName,
    publicPort,
    targetPort,
    protocol,
    reason: candidate.reason || `non-web exposed port ${publicPort}`,
  });
}

function parseComposePortValue(value) {
  const text = String(value).trim().replace(/^['"]|['"]$/g, '');
  if (!text || /^\d+$/.test(text)) return { targetPort: Number(text), publicPort: Number(text), protocol: 'TCP' };
  const [addressAndPorts, protocol = 'TCP'] = text.split('/');
  const parts = addressAndPorts.split(':').filter(Boolean);
  const targetPort = Number(parts.at(-1));
  const publicPort = Number(parts.length > 1 ? parts.at(-2) : parts.at(-1));
  return { targetPort, publicPort, protocol };
}

async function detectComposeRawEndpoints(root, composeFiles) {
  const candidates = [];
  for (const file of composeFiles) {
    const text = await readText(path.join(root, file));
    let serviceName = '';
    let inPorts = false;
    for (const line of text.split(/\r?\n/)) {
      const serviceMatch = line.match(/^  ([A-Za-z0-9._-]+):\s*$/);
      if (serviceMatch) {
        serviceName = serviceMatch[1];
        inPorts = false;
        continue;
      }
      if (/^\s{4}ports:\s*$/.test(line)) {
        inPorts = true;
        continue;
      }
      if (inPorts && /^\s{4}[A-Za-z0-9._-]+:\s*/.test(line)) {
        inPorts = false;
      }
      const portMatch = inPorts ? line.match(/^\s*-\s*(.+?)\s*$/) : null;
      if (portMatch) {
        addRawEndpointCandidate(candidates, {
          ...parseComposePortValue(portMatch[1]),
          serviceName,
          source: file,
          reason: `compose service ${serviceName || 'unknown'} exposes a non-web port`,
        });
      }
    }
  }
  return candidates.map(({ key, ...candidate }) => candidate);
}

async function detectKubernetesRawEndpoints(root, kubernetesFiles) {
  const candidates = [];
  for (const file of kubernetesFiles) {
    const text = await readText(path.join(root, file));
    if (!/kind\s*:\s*Service\b/.test(text)) continue;
    const name = text.match(/metadata\s*:[\s\S]*?name\s*:\s*([A-Za-z0-9._-]+)/)?.[1] || path.basename(file);
    const portBlocks = text.split(/\n\s*-\s+/).slice(1);
    for (const block of portBlocks) {
      const port = Number(block.match(/(?:^|\n)\s*port\s*:\s*(\d+)/)?.[1]);
      const targetPort = Number(block.match(/(?:^|\n)\s*targetPort\s*:\s*(\d+)/)?.[1] || port);
      const protocol = block.match(/(?:^|\n)\s*protocol\s*:\s*([A-Za-z]+)/)?.[1] || 'TCP';
      addRawEndpointCandidate(candidates, {
        serviceName: name,
        source: file,
        publicPort: port,
        targetPort,
        protocol,
        reason: `kubernetes Service ${name} exposes a non-web port`,
      });
    }
  }
  return candidates.map(({ key, ...candidate }) => candidate);
}

async function detectDockerfileRoot(dir, rel, allFiles) {
  const prefix = rel === '.' ? '' : `${rel}/`;
  const filesAtRoot = allFiles.filter(file => path.dirname(file) === (rel === '.' ? '.' : rel)).map(file => path.basename(file));
  const dockerfile = filesAtRoot.find(file => /^Dockerfile/i.test(file));
  if (!dockerfile) return null;
  const dockerfileText = await readText(path.join(dir, dockerfile));
  const pyproject = await readText(path.join(dir, 'pyproject.toml'));
  return {
    root: rel,
    name: projectNameFromPyproject(pyproject) || path.basename(dir),
    framework: pyproject ? 'python' : null,
    mode: 'dockerfile',
    dockerfile,
    buildCommand: undefined,
    startCommand: undefined,
    outputs: [],
    candidatePort: candidatePort(null, dockerfileText),
  };
}

async function detectPackageRoot(dir, rel, allFiles) {
  const pkgPath = path.join(dir, 'package.json');
  const pkg = await readJson(pkgPath);
  if (!pkg) return null;
  const prefix = rel === '.' ? '' : `${rel}/`;
  const filesAtRoot = allFiles.filter(file => path.dirname(file) === (rel === '.' ? '.' : rel)).map(file => path.basename(file));
  const dockerfile = filesAtRoot.find(file => /^Dockerfile/i.test(file));
  const dockerfileText = dockerfile ? await readText(path.join(dir, dockerfile)) : '';
  const framework = detectFramework(pkg, filesAtRoot);
  const scripts = pkg.scripts || {};
  const buildCommand = scripts.build ? `${packageManager(allFiles) || 'npm'} run build` : undefined;
  const startCommand = scripts.start ? `${packageManager(allFiles) || 'npm'} run start` : undefined;
  const outputs = ['dist', 'build', 'out', '.next'].filter(name => allFiles.some(file => file.startsWith(`${prefix}${name}/`) || file === `${prefix}${name}`));
  const mode = dockerfile ? 'dockerfile' : (framework && ['vite', 'react', 'vue', 'sveltekit'].includes(framework) ? 'static-candidate' : (framework || startCommand ? 'app-candidate' : 'metadata-only'));
  return {
    root: rel,
    name: pkg.name || path.basename(dir),
    framework,
    mode,
    dockerfile,
    buildCommand,
    startCommand,
    outputs,
    candidatePort: candidatePort(pkg, dockerfileText),
  };
}

async function main() {
  const files = await walk(root);
  const packageRoots = [];
  const detectedRoots = new Set();
  for (const file of files.filter(file => path.basename(file) === 'package.json')) {
    const rel = path.dirname(file) || '.';
    const detected = await detectPackageRoot(path.join(root, rel), rel, files);
    if (detected) {
      packageRoots.push(detected);
      detectedRoots.add(rel);
    }
  }
  for (const file of files.filter(file => /^Dockerfile/i.test(path.basename(file)))) {
    const rel = path.dirname(file) || '.';
    if (detectedRoots.has(rel)) continue;
    const detected = await detectDockerfileRoot(path.join(root, rel), rel, files);
    if (detected) packageRoots.push(detected);
  }

  const composeFiles = COMPOSE_FILES.filter(file => files.includes(file));
  const kubernetesFiles = files.filter(file => {
    const dir = file.split(path.sep)[0];
    return K8S_DIRS.has(dir) && /\.ya?ml$/i.test(file);
  });
  for (const file of files.filter(file => /\.ya?ml$/i.test(file))) {
    if (kubernetesFiles.includes(file)) continue;
    const text = await readText(path.join(root, file));
    if (/apiVersion\s*:/.test(text) && /kind\s*:/.test(text)) kubernetesFiles.push(file);
  }

  const rawPublicEndpointCandidates = [
    ...(await detectComposeRawEndpoints(root, composeFiles)),
    ...(await detectKubernetesRawEndpoints(root, kubernetesFiles)),
  ];

  const workspace = {
    pnpmWorkspace: files.includes('pnpm-workspace.yaml'),
    packageWorkspaces: Boolean((await readJson(path.join(root, 'package.json')))?.workspaces),
    turbo: files.includes('turbo.json'),
    nx: files.includes('nx.json'),
  };

  const deployableServices = packageRoots.filter(service => service.mode === 'dockerfile' || service.mode === 'static-candidate' || service.mode === 'app-candidate');
  const ambiguity = [];
  if (deployableServices.length > 1) ambiguity.push('multiple-deployable-services');
  if (composeFiles.length > 0 && deployableServices.length > 0) ambiguity.push('compose-and-source-services');
  if (kubernetesFiles.length > 0 && (composeFiles.length > 0 || deployableServices.length > 0)) ambiguity.push('kubernetes-and-other-inputs');

  const recommendation = composeFiles.length > 0
    ? 'compose-import'
    : kubernetesFiles.length > 0
      ? 'kubernetes-import'
      : deployableServices.length === 1
        ? deployableServices[0].mode
        : 'ask';

  console.log(JSON.stringify({
    root,
    packageManager: packageManager(files),
    workspace,
    composeFiles,
    kubernetesFiles,
    rawPublicEndpointCandidates,
    services: packageRoots,
    deployableServices,
    ambiguity,
    recommendation,
    shouldAsk: ambiguity.length > 0 || recommendation === 'ask',
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
