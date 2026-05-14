import { CliContext } from '../lib/args';
import { remoteRead } from './remote-read';

export async function releases(ctx: CliContext) {
  return remoteRead(ctx, 'releases');
}
