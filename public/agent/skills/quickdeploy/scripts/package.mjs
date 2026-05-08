#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const outIndex = process.argv.indexOf('--out');
const outPath = path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(process.cwd(), 'quickdeploy-context.tar'));

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next/cache', '.quickdeploy/generated', '.pnpm-store', '.turbo', '.cache', 'coverage']);
const SECRET_FILE_PATTERNS = [
  /^\.env($|\.)/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^id_rsa/,
  /^id_ed25519/,
  /\.pem$/,
  /\.key$/,
  /^kube-config\.config$/,
];
const JUNK_FILE_PATTERNS = [/^\.DS_Store$/];

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: package.mjs <root> --out <context.tar>');
  process.exit(1);
}

function isForbiddenName(name) {
  return SECRET_FILE_PATTERNS.some(pattern => pattern.test(name)) || JUNK_FILE_PATTERNS.some(pattern => pattern.test(name));
}

function isForbiddenPath(rel) {
  const parts = rel.split(path.sep);
  if (parts.some(part => isForbiddenName(part))) return true;
  return SKIP_DIRS.has(rel) || parts.some((_part, index) => SKIP_DIRS.has(parts.slice(0, index + 1).join('/')));
}

function tarHeader(name, size, mode = 0o644, type = '0') {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.fill(' ', 148, 156);
  header.write(type, 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return header;
}

async function collect(dir, base = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (isForbiddenPath(rel)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to package symlink: ${rel}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collect(full, rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files.sort();
}

async function main() {
  if (!process.argv[2]) usage();
  if (outIndex < 0 || !process.argv[outIndex + 1]) usage('Missing --out path.');
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) usage('Root must be a directory.');

  const files = await collect(root);
  if (files.length === 0) throw new Error('No files to package after exclusions.');

  const chunks = [];
  for (const rel of files) {
    const full = path.join(root, rel);
    const body = await fs.readFile(full);
    const tarName = rel.split(path.sep).join('/');
    chunks.push(tarHeader(tarName, body.length));
    chunks.push(body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(chunks);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, tar, { mode: 0o600 });
  const contentHash = `sha256:${crypto.createHash('sha256').update(tar).digest('hex')}`;
  console.log(JSON.stringify({ outPath, contentHash, uploadBytes: tar.length, files }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
