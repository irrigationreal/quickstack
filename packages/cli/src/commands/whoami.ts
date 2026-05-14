import { CliContext } from '../lib/args';
import { request } from '../lib/api-client';
import { emit } from '../lib/output';

export async function whoami(ctx: CliContext) {
  const result = await request('/api/v1/agent/me');
  emit(ctx, 'success', { message: `Authenticated as ${result.user?.email || 'QuickStack API key'}.`, result });
}
