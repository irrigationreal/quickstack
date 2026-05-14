import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_DEPTH = 4;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.quickstack', '.quickdeploy', '.turbo', '.cache', '.pnpm-store', '.venv', '__pycache__']);
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const K8S_DIRS = new Set(['k8s', 'kubernetes', 'deploy', '.k8s']);

export type DetectionEvidence = {
  kind: string;
  sourcePath: string;
  reason: string;
  value?: unknown;
};

async function readJson(file: string) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function readText(file: string) {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

async function walk(root: string, dir = root, depth = 0, acc: string[] = []) {
  if (depth > MAX_DEPTH) return acc;
  let entries: any[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full) || '.';
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(root, full, depth + 1, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

function packageManager(files: string[]) {
  if (files.includes('pnpm-lock.yaml') || files.includes('pnpm-workspace.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('package-lock.json')) return 'npm';
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun';
  return null;
}

function detectFramework(pkg: any, filesAtRoot: string[]) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps.next) return 'next';
  if (deps.vite || filesAtRoot.includes('vite.config.ts') || filesAtRoot.includes('vite.config.js')) return 'vite';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.vue || deps['@vue/cli-service']) return 'vue';
  if (deps.react) return 'react';
  if (deps.express || deps.fastify || deps.koa || deps.hono || deps.nestjs || deps['@nestjs/core']) return 'node-server';
  return null;
}

function candidatePort(pkg: any, dockerfileText: string) {
  const scripts = Object.values(pkg?.scripts || {}).join('\n');
  const text = `${scripts}\n${dockerfileText}`;
  const expose = dockerfileText.match(/EXPOSE\s+(\d+)/i)?.[1];
  if (expose) return Number(expose);
  const port = text.match(/PORT\s*=\s*(\d+)/)?.[1] || text.match(/--port\s+(\d+)/)?.[1] || text.match(/-p\s+(\d+)/)?.[1];
  return port ? Number(port) : undefined;
}

async function detectPackageRoot(root: string, rel: string, files: string[]) {
  const dir = path.join(root, rel);
  const pkg = await readJson(path.join(dir, 'package.json'));
  if (!pkg) return null;
  const prefix = rel === '.' ? '' : `${rel}/`;
  const filesAtRoot = files.filter(file => path.dirname(file) === (rel === '.' ? '.' : rel)).map(file => path.basename(file));
  const dockerfile = filesAtRoot.find(file => /^Dockerfile/i.test(file));
  const dockerfileText = dockerfile ? await readText(path.join(dir, dockerfile)) : '';
  const framework = detectFramework(pkg, filesAtRoot);
  const scripts = pkg.scripts || {};
  const buildCommand = scripts.build ? `${packageManager(files) || 'npm'} run build` : undefined;
  const startCommand = scripts.start ? `${packageManager(files) || 'npm'} run start` : undefined;
  const outputs = ['dist', 'build', 'out', '.next'].filter(name => files.some(file => file.startsWith(`${prefix}${name}/`) || file === `${prefix}${name}`));
  const mode = dockerfile ? 'dockerfile' : (framework && ['vite', 'react', 'vue', 'sveltekit'].includes(framework) ? 'static-candidate' : (framework || startCommand ? 'app-candidate' : 'metadata-only'));
  const detectedPort = candidatePort(pkg, dockerfileText);
  const evidence: DetectionEvidence[] = [{ kind: 'service-root', sourcePath: path.join(rel, 'package.json'), reason: 'package.json marks a possible deployable service root', value: rel }];
  if (framework) evidence.push({ kind: 'framework', sourcePath: path.join(rel, 'package.json'), reason: `${framework} dependency or config detected`, value: framework });
  if (dockerfile) evidence.push({ kind: 'dockerfile', sourcePath: path.join(rel, dockerfile), reason: 'Dockerfile exists in service root', value: dockerfile });
  if (detectedPort) evidence.push({ kind: 'port', sourcePath: dockerfile ? path.join(rel, dockerfile) : path.join(rel, 'package.json'), reason: 'port inferred from Dockerfile or package scripts', value: detectedPort });
  for (const output of outputs) evidence.push({ kind: 'output-dir', sourcePath: path.join(rel, output), reason: 'known build output directory exists', value: output });
  return { root: rel, name: pkg.name || path.basename(dir), framework, mode, dockerfile, buildCommand, startCommand, outputs, candidatePort: detectedPort, evidence };
}

export async function detectProject(root: string) {
  const files = await walk(root);
  const packageRoots = [];
  for (const file of files.filter(file => path.basename(file) === 'package.json')) {
    const rel = path.dirname(file) || '.';
    const detected = await detectPackageRoot(root, rel, files);
    if (detected) packageRoots.push(detected);
  }
  const composeFiles = COMPOSE_FILES.filter(file => files.includes(file));
  const kubernetesFiles = files.filter(file => {
    const dir = file.split(path.sep)[0];
    return K8S_DIRS.has(dir) && /\.ya?ml$/i.test(file);
  });
  const workspace = { pnpmWorkspace: files.includes('pnpm-workspace.yaml'), packageWorkspaces: Boolean((await readJson(path.join(root, 'package.json')))?.workspaces), turbo: files.includes('turbo.json'), nx: files.includes('nx.json') };
  const evidence: DetectionEvidence[] = packageRoots.flatMap(service => service.evidence || []);
  for (const file of composeFiles) evidence.push({ kind: 'compose-file', sourcePath: file, reason: 'Docker Compose manifest detected', value: file });
  for (const file of kubernetesFiles) evidence.push({ kind: 'kubernetes-manifest', sourcePath: file, reason: 'Kubernetes manifest detected', value: file });
  if (workspace.pnpmWorkspace) evidence.push({ kind: 'workspace', sourcePath: 'pnpm-workspace.yaml', reason: 'pnpm workspace detected', value: 'pnpm' });
  const deployableServices = packageRoots.filter(service => service.mode === 'dockerfile' || service.mode === 'static-candidate' || service.mode === 'app-candidate');
  const ambiguity = [];
  if (deployableServices.length > 1) ambiguity.push('multiple-deployable-services');
  if (composeFiles.length > 0 && deployableServices.length > 0) ambiguity.push('compose-and-source-services');
  if (kubernetesFiles.length > 0 && (composeFiles.length > 0 || deployableServices.length > 0)) ambiguity.push('kubernetes-and-other-inputs');
  const recommendation = composeFiles.length > 0 ? 'compose-import' : kubernetesFiles.length > 0 ? 'kubernetes-import' : deployableServices.length === 1 ? deployableServices[0].mode : 'ask';
  return { root, packageManager: packageManager(files), workspace, composeFiles, kubernetesFiles, rawPublicEndpointCandidates: [], services: packageRoots, deployableServices, evidence, ambiguity, recommendation, shouldAsk: ambiguity.length > 0 || recommendation === 'ask' };
}
