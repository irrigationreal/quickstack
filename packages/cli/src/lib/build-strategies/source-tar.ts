import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCachedBuildResult, uploadBuildTar } from '../api-client';

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', resolve);
  });
  const stat = await fs.stat(file);
  return { contentHash: `sha256:${hash.digest('hex')}`, uploadBytes: stat.size };
}

export async function runSourceTar(appId: string, contextPath: string, metadata: Record<string, unknown>) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quickstack-source-tar-'));
  const tarPath = path.join(tmpRoot, 'source.tar');
  try {
    const tar = spawnSync('tar', ['-C', contextPath, '-cf', tarPath, '.'], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error('tar packaging failed.');
    const fileHash = await sha256File(tarPath);
    const cached = await getCachedBuildResult(appId, fileHash.contentHash);
    if (cached.status === 'hit' && cached.buildResult) {
      return { status: 'success', buildResult: cached.buildResult };
    }
    return uploadBuildTar(appId, tarPath, { ...metadata, ...fileHash, artifactType: 'source-tar' });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
