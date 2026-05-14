import { CliContext } from '../lib/args';
import { remoteRead } from './remote-read';

export async function logs(ctx: CliContext) {
  return remoteRead(ctx, 'logs');
}
