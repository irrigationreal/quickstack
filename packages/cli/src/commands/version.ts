import { CliContext } from '../lib/args';
import { emit } from '../lib/output';
import { CLI_VERSION } from '../lib/version';

export async function version(ctx: CliContext) {
  emit(ctx, 'success', { message: CLI_VERSION, version: CLI_VERSION });
}
