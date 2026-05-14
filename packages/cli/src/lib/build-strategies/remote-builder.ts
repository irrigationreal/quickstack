import { createBuild } from '../api-client';

export async function runRemoteBuilder(appId: string, options: { buildSecrets?: string[] } = {}) {
  try {
    return await createBuild(appId, { kind: 'remote-builder', sourceProvenance: 'remote-builder', buildSecrets: options.buildSecrets || [] });
  } catch (error) {
    throw new Error(`remote builder is not configured on this server. ${error instanceof Error ? error.message : String(error)}`);
  }
}
