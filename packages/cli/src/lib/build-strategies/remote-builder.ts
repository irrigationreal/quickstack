import { createBuild } from '../api-client';

export async function runRemoteBuilder(appId: string) {
  try {
    return await createBuild(appId, { kind: 'remote-builder', sourceProvenance: 'remote-builder' });
  } catch (error) {
    throw new Error(`remote builder is not configured on this server. ${error instanceof Error ? error.message : String(error)}`);
  }
}
