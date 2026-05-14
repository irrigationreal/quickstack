import { CliContext, optionValue } from '../lib/args';
import { createToken, listTokens, revokeToken } from '../lib/api-client';
import { emit, printError } from '../lib/output';

function parseScope(value = 'actor') {
  if (value === 'actor') return 'actor';
  if (value.startsWith('project:')) return { project: value.slice('project:'.length) };
  if (value.startsWith('app:')) return { app: value.slice('app:'.length) };
  throw new Error('Scope must be actor, project:<id>, or app:<id>.');
}

export async function tokens(ctx: CliContext) {
  const sub = ctx.commandArgs[0] || 'list';
  if (sub === 'list') {
    const result = await listTokens();
    emit(ctx, 'success', { message: `Fetched ${result.tokens.length} token(s).`, tokens: result.tokens });
    return;
  }
  if (sub === 'create') {
    const scope = parseScope(optionValue('--scope', ctx.commandArgs) || 'actor');
    const result = await createToken({ scope });
    emit(ctx, 'success', { message: `${result.notice}\n${result.plaintextToken}`, token: result.token, plaintextToken: result.plaintextToken, notice: result.notice });
    return;
  }
  if (sub === 'revoke') {
    const tokenId = ctx.commandArgs[1];
    if (!tokenId) printError(ctx, 'Usage: quickstack tokens revoke <token-id> [--json]');
    const result = await revokeToken(tokenId);
    emit(ctx, 'success', { message: result.message, revoked: result.revoked });
    return;
  }
  printError(ctx, 'Usage: quickstack tokens <list|create|revoke> [--scope actor|project:<id>|app:<id>] [--json]');
}
