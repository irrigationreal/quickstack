#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';

const root = path.resolve(process.argv[2] || process.cwd());
const outIndex = process.argv.indexOf('--out');
const outPath = path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(process.cwd(), 'quickdeploy-context.tar'));

const TAR_BLOCK_SIZE = 512;
const MAX_TAR_NAME_BYTES = 100;
const MAX_TAR_PREFIX_BYTES = 155;

async function loadQuickDeployIgnore() {
  const ignorePath = path.join(root, '.quickdeployignore');
  const text = await fs.readFile(ignorePath, 'utf8').catch(() => '');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function patternToRegExp(pattern) {
  const anchored = pattern.startsWith('/');
  const directory = pattern.endsWith('/');
  const body = pattern.replace(/^\//, '').replace(/\/$/, '');
  const escaped = body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  const prefix = anchored ? '^' : '(^|.*/)';
  const suffix = directory ? '(/.*)?$' : '$';
  return new RegExp(`${prefix}${escaped}${suffix}`);
}

function isIgnored(rel, ignorePatterns) {
  const normalized = rel.split(path.sep).join('/');
  return ignorePatterns.some(pattern => patternToRegExp(pattern).test(normalized));
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: package.mjs <root> --out <context.tar>');
  process.exit(1);
}

function splitTarName(name) {
  const nameBytes = Buffer.byteLength(name);
  if (nameBytes <= MAX_TAR_NAME_BYTES) {
    return { name, prefix: '' };
  }

  const parts = name.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join('/');
    const suffix = parts.slice(index).join('/');
    if (Buffer.byteLength(prefix) <= MAX_TAR_PREFIX_BYTES && Buffer.byteLength(suffix) <= MAX_TAR_NAME_BYTES) {
      return { name: suffix, prefix };
    }
  }

  throw new Error(`Refusing to package ${name}. Tar path is too long for portable ustar archives.`);
}

function writeOctal(header, value, offset, length) {
  header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
}

function tarHeader(rawName, size, mode = 0o644, type = '0') {
  const { name, prefix } = splitTarName(rawName);
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  header.write(name, 0, MAX_TAR_NAME_BYTES, 'utf8');
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(' ', 148, 156);
  header.write(type, 156, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (prefix) header.write(prefix, 345, MAX_TAR_PREFIX_BYTES, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

async function collect(dir, ignorePatterns, base = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (path.resolve(full) === outPath || isIgnored(rel, ignorePatterns)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to package symlink: ${rel}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collect(full, ignorePatterns, rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files.sort();
}

async function writeStream(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

async function appendFileToTar(stream, hash, full, rel) {
  const stat = await fs.stat(full);
  const tarName = rel.split(path.sep).join('/');
  const header = tarHeader(tarName, stat.size, stat.mode & 0o777);
  await writeStream(stream, header);
  hash.update(header);

  await new Promise((resolve, reject) => {
    const input = createReadStream(full);
    input.on('data', async (chunk) => {
      input.pause();
      try {
        await writeStream(stream, chunk);
        hash.update(chunk);
        input.resume();
      } catch (error) {
        reject(error);
      }
    });
    input.on('error', reject);
    input.on('end', resolve);
  });

  const padding = (TAR_BLOCK_SIZE - (stat.size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  if (padding) {
    const pad = Buffer.alloc(padding);
    await writeStream(stream, pad);
    hash.update(pad);
  }
  return stat.size + TAR_BLOCK_SIZE + padding;
}

async function main() {
  if (!process.argv[2]) usage();
  if (outIndex < 0 || !process.argv[outIndex + 1]) usage('Missing --out path.');
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) usage('Root must be a directory.');

  const ignorePatterns = await loadQuickDeployIgnore();
  const files = await collect(root, ignorePatterns);
  if (files.length === 0) throw new Error('No files to package.');

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const output = createWriteStream(outPath, { mode: 0o600 });
  const hash = crypto.createHash('sha256');
  let uploadBytes = 0;

  try {
    for (const rel of files) {
      uploadBytes += await appendFileToTar(output, hash, path.join(root, rel), rel);
    }
    const trailer = Buffer.alloc(TAR_BLOCK_SIZE * 2);
    await writeStream(output, trailer);
    hash.update(trailer);
    uploadBytes += trailer.length;
    output.end();
    await once(output, 'finish');
  } catch (error) {
    output.destroy();
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    throw error;
  }

  console.log(JSON.stringify({ outPath, contentHash: `sha256:${hash.digest('hex')}`, uploadBytes, files }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
