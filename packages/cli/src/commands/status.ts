import { CliContext } from '../lib/args';
import { remoteRead } from './remote-read';

export async function status(ctx: CliContext) {
  return remoteRead(ctx, 'status');
}
