import { CliContext } from '../lib/args';
import { getDoctor } from '../lib/api-client';
import { emit } from '../lib/output';

export async function doctor(ctx: CliContext) {
  const appId = ctx.commandArgs.find(arg => !arg.startsWith('-'));
  const result = await getDoctor({ appId });
  emit(ctx, 'success', {
    message: result.checks.map(check => `${check.status}: ${check.check} - ${check.message}${check.remediation ? ` (${check.remediation})` : ''}`).join('\n'),
    ...result,
  });
}
