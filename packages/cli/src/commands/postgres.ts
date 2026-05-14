import { CliContext } from '../lib/args';
import { managed } from './managed';

export async function postgres(ctx: CliContext) {
  return managed(ctx, 'postgres');
}
