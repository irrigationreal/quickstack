import { CliContext } from '../lib/args';
import { getMe } from '../lib/api-client';
import { emit } from '../lib/output';

export async function whoami(ctx: CliContext) {
  const result = await getMe();
  const projectSummary = result.projects.length === 0
    ? 'No visible projects.'
    : `${result.projects.length} visible project(s): ${result.projects.map(project => project.name).join(', ')}`;
  emit(ctx, 'success', {
    message: `Authenticated as ${result.actor.displayName}. ${projectSummary}`,
    actor: result.actor,
    projects: result.projects,
  });
}
