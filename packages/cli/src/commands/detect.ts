import path from 'node:path';
import { CliContext } from '../lib/args';
import { detectProject } from '../lib/detect';

export async function detect(ctx: CliContext) {
  const root = path.resolve(ctx.commandArgs.find(arg => !arg.startsWith('-')) || process.cwd());
  console.log(JSON.stringify(await detectProject(root), null, 2));
}
