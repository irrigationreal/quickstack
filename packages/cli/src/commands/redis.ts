import { CliContext } from '../lib/args';
import { managed } from './managed';

export async function redis(ctx: CliContext) {
  return managed(ctx, 'redis');
}
