import { CliContext } from '../lib/args';
import { managed } from './managed';

export async function mysql(ctx: CliContext) {
  return managed(ctx, 'mysql');
}
